import { describe, expect, it } from "vitest";
import fixture from "../fixtures/lhr-minimal.json";
import { AuditTimeoutError, ChromeError, LighthouseRuntimeError } from "@/server/domain/audit-errors";
import { assertRouteAuditable, planFirstScan, planProfiles, type CoveredProfile, type FirstScanRoute } from "@/server/domain/audit-rules";
import { classifyError } from "@/server/domain/error-classifier";
import { DomainError } from "@/server/domain/errors";
import { buildAuditKey, routeSlug } from "@/server/domain/r2-key";
import { extractResults, topOpportunities, type LhrLike } from "@/server/domain/score-extraction";

describe("r2-key", () => {
  const base = {
    clientSlug: "acme",
    projectSlug: "web",
    routePath: "/",
    profile: "mobile" as const,
    auditId: "11111111-2222-4333-8444-555555555555",
    at: new Date("2026-11-02T15:30:45.123Z"),
  };

  it("arma cliente/proyecto/año/mes/marca_ruta_perfil_id.json.gz en UTC", () => {
    expect(buildAuditKey(base)).toBe(
      "acme/web/2026/11/20261102T153045Z_home_mobile_11111111-2222-4333-8444-555555555555.json.gz",
    );
  });

  it("usa el mes y el año UTC aunque sea fin de mes local", () => {
    const key = buildAuditKey({ ...base, at: new Date("2026-12-31T23:59:59Z") });
    expect(key.startsWith("acme/web/2026/12/20261231T235959Z_")).toBe(true);
    expect(buildAuditKey({ ...base, at: new Date("2027-01-01T00:00:00Z") }).startsWith("acme/web/2027/01/")).toBe(true);
  });

  it.each([
    ["/", "home"],
    ["/blog/mi-post", "blog-mi-post"],
    ["/Café/Ñandú", "cafe-nandu"],
    ["/???", "ruta"],
    ["/" + "a".repeat(100), "a".repeat(40)],
  ])("routeSlug(%j) = %j", (path, expected) => {
    expect(routeSlug(path)).toBe(expected);
  });

  it("nunca produce una clave con segmentos peligrosos", () => {
    const key = buildAuditKey({ ...base, routePath: "/../../etc/passwd" });
    expect(key).not.toContain("..");
    expect(key.split("/")).toHaveLength(5);
  });
});

describe("score-extraction", () => {
  it("lee puntuaciones y métricas de un resultado real de Lighthouse", () => {
    const r = extractResults(fixture as LhrLike);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metrics).toMatchObject({
      scorePerformance: 100,
      scoreAccessibility: 95,
      scoreBestPractices: 96,
      scoreSeo: 100,
      lcpMs: 641,
      cls: "0.0000",
      tbtMs: 0,
      fcpMs: 641,
      ttfbMs: 9,
      inpMs: null,
      lighthouseVersion: "13.6.0",
      finalUrl: "http://127.0.0.1:18123/",
      httpStatus: 200,
    });
  });

  it("redondea y limita las puntuaciones a 0-100", () => {
    const r = extractResults({ categories: { performance: { score: 0.894 }, seo: { score: 1.4 }, accessibility: { score: -1 }, "best-practices": { score: 0.895 } } });
    expect(r.ok && [r.metrics.scorePerformance, r.metrics.scoreSeo, r.metrics.scoreAccessibility, r.metrics.scoreBestPractices]).toEqual([89, 100, 0, 90]);
  });

  it("tolera categorías o métricas ausentes", () => {
    const r = extractResults({ categories: { performance: { score: 0.5 }, seo: { score: null } } });
    expect(r.ok && r.metrics).toMatchObject({ scorePerformance: 50, scoreSeo: null, scoreAccessibility: null, lcpMs: null, cls: null, httpStatus: null });
  });

  it("si Lighthouse reporta un error de ejecución, no hay datos", () => {
    expect(extractResults({ runtimeError: { code: "NO_FCP", message: "sin contenido" }, categories: { performance: { score: null } } })).toEqual({
      ok: false,
      code: "NO_FCP",
      message: "sin contenido",
    });
  });

  it("sin ninguna puntuación es un resultado inválido", () => {
    expect(extractResults({})).toMatchObject({ ok: false, code: "INVALID_RESULT" });
  });

  it("elige el documento principal entre las peticiones de red", () => {
    const r = extractResults({
      finalDisplayedUrl: "https://acme.test/",
      categories: { performance: { score: 1 } },
      audits: {
        "network-requests": {
          details: {
            items: [
              { url: "https://acme.test/app.js", statusCode: 200, resourceType: "Script" },
              { url: "https://acme.test/", statusCode: 301, resourceType: "Document" },
            ],
          },
        },
      },
    });
    expect(r.ok && r.metrics.httpStatus).toBe(301);
  });

  it("lista las mejoras con ahorro, de mayor a menor, ignorando las de cero", () => {
    expect(topOpportunities(fixture as LhrLike).map((o) => [o.id, o.savingsMs])).toEqual([
      ["unused-javascript", 1200],
      ["render-blocking-resources", 450],
    ]);
    expect(topOpportunities(fixture as LhrLike, 1)).toHaveLength(1);
  });
});

describe("error-classifier", () => {
  const lh = (code: string, msg = "") => classifyError(new LighthouseRuntimeError(code, msg));

  it.each([
    ["NO_FCP", "NO_FCP", true],
    ["PAGE_HUNG", "PAGE_HUNG", true],
    ["DNS_FAILURE", "SITE_DOWN", true],
    ["FAILED_DOCUMENT_REQUEST", "SITE_DOWN", true],
    ["INSECURE_DOCUMENT_REQUEST", "TLS_ERROR", false],
    ["PROTOCOL_TIMEOUT", "TIMEOUT", true],
    ["ALGO_NUEVO", "ALGO_NUEVO", true],
  ])("Lighthouse %s -> %s (reintentable: %s)", (input, code, retryable) => {
    expect(lh(input)).toMatchObject({ code, retryable });
  });

  it("distingue errores 5xx (reintentar) de 4xx (no reintentar)", () => {
    expect(lh("ERRORED_DOCUMENT_REQUEST", "Status code: 503")).toMatchObject({ code: "HTTP_5XX", retryable: true });
    expect(lh("ERRORED_DOCUMENT_REQUEST", "Status code: 404")).toMatchObject({ code: "HTTP_4XX", retryable: false });
    expect(lh("ERRORED_DOCUMENT_REQUEST", "sin código")).toMatchObject({ code: "SITE_DOWN", retryable: true });
  });

  it("clasifica errores propios y de negocio", () => {
    expect(classifyError(new AuditTimeoutError(90_000))).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(classifyError(new DomainError("FORBIDDEN_HOST", "host no permitido"))).toMatchObject({ code: "FORBIDDEN_HOST", retryable: false });
    expect(classifyError(new DomainError("NOT_FOUND", "Ruta no encontrada."))).toMatchObject({ code: "NOT_FOUND", retryable: false });
    expect(classifyError(new DomainError("UPSTREAM", "no respondió"))).toMatchObject({ code: "SITE_DOWN", retryable: true });
  });

  it("distingue un Chromium caído (reintentar) de uno que no está instalado (no reintentar)", () => {
    expect(classifyError(new ChromeError("Chrome process exited with code 1"))).toMatchObject({ code: "CHROME_CRASH", retryable: true });
    expect(classifyError(new Error("Protocol error (Target.closeTarget): Target closed"))).toMatchObject({ code: "CHROME_CRASH", retryable: true });
    expect(classifyError(new ChromeError("No Chrome installations found, ENOENT"))).toMatchObject({ code: "CHROME_MISSING", retryable: false });
  });

  it("separa un problema de configuración de R2 (no reintentar) de una caída temporal (reintentar)", () => {
    expect(classifyError({ name: "AccessDenied", message: "x" })).toMatchObject({ code: "R2_CONFIG", retryable: false });
    expect(classifyError({ name: "NoSuchBucket", message: "x" })).toMatchObject({ code: "R2_CONFIG", retryable: false });
    expect(classifyError({ name: "Whatever", $metadata: { httpStatusCode: 403 } })).toMatchObject({ code: "R2_CONFIG", retryable: false });
    expect(classifyError({ name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } })).toMatchObject({ code: "R2_UNAVAILABLE", retryable: true });
    expect(classifyError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toMatchObject({ code: "R2_UNAVAILABLE", retryable: true });
  });

  it("un error desconocido se reintenta y su mensaje se recorta", () => {
    const c = classifyError(new Error("x".repeat(1000)));
    expect(c).toMatchObject({ code: "UNKNOWN", retryable: true });
    expect(c.message.length).toBeLessThanOrEqual(300);
    expect(classifyError("texto suelto")).toMatchObject({ code: "UNKNOWN", retryable: true });
    expect(classifyError(null)).toMatchObject({ code: "UNKNOWN" });
  });
});

describe("audit-rules", () => {
  it("en desarrollo permite uno o ambos perfiles, por defecto ambos", () => {
    expect(planProfiles("development", ["mobile"], "manual")).toEqual(["mobile"]);
    expect(planProfiles("development", ["mobile", "desktop"], "manual")).toEqual(["mobile", "desktop"]);
    expect(planProfiles("development", [], "manual")).toEqual(["mobile", "desktop"]);
    expect(planProfiles("development", undefined, "mcp")).toEqual(["mobile", "desktop"]);
    expect(() => planProfiles("development", ["tablet" as never], "manual")).toThrow(DomainError);
  });

  it("en producción manual permite uno o ambos, por defecto ambos", () => {
    expect(planProfiles("production", ["desktop"], "manual")).toEqual(["desktop"]);
    expect(planProfiles("production", ["mobile", "desktop", "mobile"], "manual")).toEqual(["mobile", "desktop"]);
    expect(planProfiles("production", undefined, "manual")).toEqual(["mobile", "desktop"]);
  });

  it("lo programado siempre es ambos perfiles y solo en producción", () => {
    expect(planProfiles("production", undefined, "scheduled")).toEqual(["mobile", "desktop"]);
    expect(planProfiles("development", undefined, "scheduled")).toEqual([]);
  });

  it("rechaza perfiles inventados", () => {
    expect(() => planProfiles("production", ["tablet" as never], "manual")).toThrow(/Perfil no válido/);
  });

  it("la URL de la ruta debe seguir en un host permitido", () => {
    expect(() => assertRouteAuditable("https://acme.test/x", ["acme.test"])).not.toThrow();
    expect(() => assertRouteAuditable("https://otro.test/x", ["acme.test"])).toThrowError(expect.objectContaining({ code: "FORBIDDEN_HOST" }));
    expect(() => assertRouteAuditable("no-es-url", ["acme.test"])).toThrow(DomainError);
  });
});

describe("planFirstScan", () => {
  const route = (id: string, path: string, extra: Partial<FirstScanRoute> = {}): FirstScanRoute => ({ id, path, monitored: true, requiresAuth: false, ...extra });
  const plan = (routes: FirstScanRoute[], covered: CoveredProfile[] = [], authConfigured = false, budget = 50) =>
    planFirstScan({ routes, covered, authConfigured, budget });

  it("encola móvil y escritorio de cada ruta monitoreada, en orden de ruta", () => {
    const p = plan([route("b", "/b"), route("a", "/a")]);
    expect(p.targets).toEqual([
      { routeId: "a", profiles: ["mobile", "desktop"] },
      { routeId: "b", profiles: ["mobile", "desktop"] },
    ]);
    expect(p).toMatchObject({ toQueue: 4, alreadyPending: 0, skippedAuth: 0, routesWithoutRoom: 0 });
  });

  it("ignora las rutas no monitoreadas", () => {
    const p = plan([route("a", "/a", { monitored: false }), route("b", "/b")]);
    expect(p.targets.map((t) => t.routeId)).toEqual(["b"]);
  });

  it("solo pide lo que falta: lo correcto y lo pendiente cuentan como cubierto, lo fallido se reintenta", () => {
    const p = plan(
      [route("a", "/a"), route("b", "/b"), route("c", "/c")],
      [
        { routeId: "a", profile: "mobile", state: "succeeded" },
        { routeId: "a", profile: "desktop", state: "succeeded" },
        { routeId: "b", profile: "mobile", state: "pending" },
      ],
    );
    // «c» no tiene nada (o solo una auditoría fallida, que no aparece como cubierta).
    expect(p.targets).toEqual([
      { routeId: "b", profiles: ["desktop"] },
      { routeId: "c", profiles: ["mobile", "desktop"] },
    ]);
    expect(p).toMatchObject({ toQueue: 3, alreadyPending: 1 });
  });

  it("si una auditoría correcta y una pendiente coinciden, prevalece la correcta", () => {
    const p = plan(
      [route("a", "/a")],
      [
        { routeId: "a", profile: "mobile", state: "pending" },
        { routeId: "a", profile: "mobile", state: "succeeded" },
        { routeId: "a", profile: "desktop", state: "succeeded" },
      ],
    );
    expect(p).toMatchObject({ targets: [], toQueue: 0, alreadyPending: 0 });
  });

  it("omite las rutas con sesión si el proyecto no tiene acceso, y las incluye si lo tiene", () => {
    const routes = [route("a", "/a"), route("p", "/privada", { requiresAuth: true })];
    const sin = plan(routes, [], false);
    expect(sin.targets.map((t) => t.routeId)).toEqual(["a"]);
    expect(sin.skippedAuth).toBe(1);
    const con = plan(routes, [], true);
    expect(con.targets.map((t) => t.routeId)).toEqual(["a", "p"]);
    expect(con.skippedAuth).toBe(0);
  });

  it("llena el cupo ruta a ruta con los dos dispositivos juntos y cuenta lo que no cabe", () => {
    const routes = [route("a", "/a"), route("b", "/b"), route("c", "/c")];
    const p = plan(routes, [], false, 5);
    expect(p.targets.map((t) => t.routeId)).toEqual(["a", "b"]);
    expect(p).toMatchObject({ toQueue: 4, routesWithoutRoom: 1 });
    expect(plan(routes, [], false, 0)).toMatchObject({ targets: [], routesWithoutRoom: 3 });
  });

  it("una ruta a la que solo le falta un dispositivo cabe en un cupo de 1", () => {
    const p = plan([route("a", "/a"), route("b", "/b")], [{ routeId: "a", profile: "mobile", state: "succeeded" }], false, 1);
    expect(p.targets).toEqual([{ routeId: "a", profiles: ["desktop"] }]);
    expect(p.routesWithoutRoom).toBe(1);
  });

  it("con todo cubierto no hay nada que hacer", () => {
    const covered: CoveredProfile[] = (["mobile", "desktop"] as const).map((profile) => ({ routeId: "a", profile, state: "succeeded" }));
    expect(plan([route("a", "/a")], covered)).toMatchObject({ targets: [], toQueue: 0, skippedAuth: 0, routesWithoutRoom: 0 });
  });
});
