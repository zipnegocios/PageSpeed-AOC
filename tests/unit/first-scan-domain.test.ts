import { describe, expect, it } from "vitest";
import { coveredKey, describeFirstScan, planFirstScan, type FirstScanResult, type ScanRoute } from "@/server/domain/first-scan";

const route = (id: string, extra: Partial<ScanRoute> = {}): ScanRoute => ({ id, url: `https://acme.test/${id}`, requiresAuth: false, ...extra });
const opts = { authConfigured: false, allowedHosts: ["acme.test"] };

describe("plan del primer escaneo", () => {
  it("pide móvil y escritorio para las rutas sin auditoría", () => {
    const plan = planFirstScan([route("a"), route("b")], new Set(), opts);
    expect(plan.items).toEqual([
      { routeId: "a", profiles: ["mobile", "desktop"] },
      { routeId: "b", profiles: ["mobile", "desktop"] },
    ]);
    expect(plan.audits).toBe(4);
    expect(plan).toMatchObject({ skippedAuth: 0, skippedHost: 0 });
  });

  it("solo pide el perfil que falta y no repite lo ya cubierto", () => {
    const covered = new Set([coveredKey("a", "desktop"), coveredKey("b", "mobile"), coveredKey("b", "desktop")]);
    const plan = planFirstScan([route("a"), route("b"), route("c")], covered, opts);
    expect(plan.items).toEqual([
      { routeId: "a", profiles: ["mobile"] },
      { routeId: "c", profiles: ["mobile", "desktop"] },
    ]);
    expect(plan.audits).toBe(3);
  });

  it("sin nada pendiente el plan queda vacío", () => {
    const covered = new Set([coveredKey("a", "mobile"), coveredKey("a", "desktop")]);
    expect(planFirstScan([route("a")], covered, opts)).toEqual({ items: [], audits: 0, skippedAuth: 0, skippedHost: 0 });
    expect(planFirstScan([], new Set(), opts).audits).toBe(0);
  });

  it("deja para después las rutas con sesión si el proyecto no tiene acceso configurado, y las incluye si lo tiene", () => {
    const routes = [route("a"), route("privada", { requiresAuth: true })];
    const sin = planFirstScan(routes, new Set(), opts);
    expect(sin.items.map((i) => i.routeId)).toEqual(["a"]);
    expect(sin.skippedAuth).toBe(1);
    const con = planFirstScan(routes, new Set(), { ...opts, authConfigured: true });
    expect(con.items.map((i) => i.routeId)).toEqual(["a", "privada"]);
    expect(con.skippedAuth).toBe(0);
  });

  it("una ruta con sesión que ya está cubierta no cuenta como omitida", () => {
    const covered = new Set([coveredKey("privada", "mobile"), coveredKey("privada", "desktop")]);
    expect(planFirstScan([route("privada", { requiresAuth: true })], covered, opts).skippedAuth).toBe(0);
  });

  it("omite las rutas cuyo host ya no está permitido", () => {
    const plan = planFirstScan([route("a"), { id: "x", url: "https://otro.test/x", requiresAuth: false }], new Set(), opts);
    expect(plan.items.map((i) => i.routeId)).toEqual(["a"]);
    expect(plan.skippedHost).toBe(1);
  });
});

describe("mensaje del primer escaneo", () => {
  const base: FirstScanResult = { queued: 0, routesQueued: 0, alreadyPending: 0, remaining: 0, skippedAuth: 0, skippedHost: 0 };

  it("cuenta lo encolado y avisa que se procesa de una en una", () => {
    const text = describeFirstScan({ ...base, queued: 6, routesQueued: 3 });
    expect(text).toContain("6 auditorías");
    expect(text).toContain("3 rutas");
    expect(text).toContain("de una en una");
    expect(describeFirstScan({ ...base, queued: 2, routesQueued: 1 })).toContain("1 ruta.");
    expect(describeFirstScan({ ...base, queued: 1, routesQueued: 1 })).toContain("1 auditoría ");
  });

  it("dice cuándo todo estaba ya escaneado", () => {
    expect(describeFirstScan(base)).toBe("Todas las rutas ya tienen su primer escaneo.");
  });

  it("explica lo que quedó fuera y qué hacer", () => {
    expect(describeFirstScan({ ...base, queued: 50, routesQueued: 25, remaining: 10 })).toMatch(/10 auditorías quedaron sin encolar.*vuelve a pulsar/);
    expect(describeFirstScan({ ...base, remaining: 1, queued: 2, routesQueued: 1 })).toMatch(/1 auditoría quedó sin encolar/);
    expect(describeFirstScan({ ...base, skippedAuth: 2 })).toMatch(/2 rutas que requieren sesión.*Acceso a páginas privadas/);
    expect(describeFirstScan({ ...base, skippedAuth: 1 })).toMatch(/1 ruta que requiere sesión/);
    expect(describeFirstScan({ ...base, skippedHost: 1 })).toMatch(/1 ruta porque su host/);
    expect(describeFirstScan({ ...base, alreadyPending: 2 })).toMatch(/2 auditorías ya estaban pendientes/);
  });
});
