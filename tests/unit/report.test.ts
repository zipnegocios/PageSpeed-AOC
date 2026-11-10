import { describe, expect, it } from "vitest";
import { createSerialCache } from "@/server/report/cache";
import { renderReportPdf } from "@/server/report/pdf";
import { buildReportEmail } from "@/server/notify/report-email";
import { computeChange } from "@/server/domain/history";
import { scoreBand } from "@/server/domain/score-band";
import { reportFilename, type ReportData } from "@/server/services/report";
import { lightToken } from "@/lib/tokens";

describe("createSerialCache", () => {
  it("reutiliza el resultado dentro del TTL y lo regenera después", async () => {
    let t = 0;
    let calls = 0;
    const cache = createSerialCache<number>({ ttlMs: 1000, now: () => t });
    const make = async () => ++calls;
    expect(await cache.get("a", make)).toBe(1);
    t = 999;
    expect(await cache.get("a", make)).toBe(1);
    t = 1000;
    expect(await cache.get("a", make)).toBe(2);
    expect(await cache.get("b", make)).toBe(3);
  });

  it("peticiones simultáneas de la misma clave comparten una sola generación", async () => {
    let calls = 0;
    const cache = createSerialCache<number>({ ttlMs: 1000 });
    const make = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return calls; };
    const out = await Promise.all([cache.get("k", make), cache.get("k", make), cache.get("k", make)]);
    expect(out).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });

  it("genera de uno en uno aunque las claves sean distintas", async () => {
    let active = 0;
    let peak = 0;
    const cache = createSerialCache<string>({ ttlMs: 1000 });
    const make = (id: string) => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return id;
    };
    await Promise.all(["a", "b", "c", "d"].map((k) => cache.get(k, make(k))));
    expect(peak).toBe(1);
  });

  it("un fallo no se guarda y no detiene la cola", async () => {
    const cache = createSerialCache<string>({ ttlMs: 1000 });
    await expect(cache.get("x", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await cache.get("x", async () => "ok")).toBe("ok");
    expect(await cache.get("y", async () => "otro")).toBe("otro");
  });

  it("descarta lo más antiguo al pasar el máximo", async () => {
    let calls = 0;
    const cache = createSerialCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    const make = async () => ++calls;
    await cache.get("a", make); await cache.get("b", make); await cache.get("c", make);
    await cache.get("a", make); // "a" ya no estaba
    expect(calls).toBe(4);
  });
});

describe("informe", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const day = 86_400_000;
  const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ at: new Date(now.getTime() - (n - i) * day), value: 60 + i }));
  const latest = (path: string, profile: "mobile" | "desktop", p: number) => ({
    routeId: path + profile, path, profile, auditId: "a", finishedAt: now, agentic: null, metrics: { lcpMs: 2000, cls: 0.02, tbtMs: 100 },
    scores: { performance: p, seo: 93, accessibility: 88, best_practices: 100 },
    changes: { performance: computeChange("performance", p, p + 5), seo: computeChange("seo", 93, 93), accessibility: null, best_practices: null },
  });
  const base: ReportData = {
    generatedAt: now, days: 30, from: new Date(now.getTime() - 30 * day), clientName: "Acme S.A.", contactName: "Ana", contactEmail: "ana@acme.test",
    projectId: "p", projectName: "Tienda ñandú", baseUrl: "https://acme.test", performanceThreshold: 80,
    latest: [latest("/", "mobile", 72), latest("/contacto", "desktop", 40)],
    improvements: [{ routePath: "/", profile: "mobile", text: "Rendimiento 72 (mínimo 80)" }],
    charts: [{ routePath: "/", profile: "mobile", points: pts(12), ranges: [{ metric: "seo", first: 90, last: 93, min: 90, max: 93 }] }],
  };

  it("genera un PDF A4 válido con título, fuentes incrustadas y sin Helvetica", async () => {
    const pdf = await renderReportPdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
    const text = pdf.toString("latin1");
    expect(text).toContain("Rajdhani");
    expect(text).not.toContain("Helvetica");
    expect(text).toMatch(/MediaBox\s*\[\s*0\s+0\s+595\.2\d*\s+841\.8\d*/);
  });

  it("aguanta informes vacíos y proyectos con muchas rutas (varias páginas)", async () => {
    const empty = await renderReportPdf({ ...base, latest: [], improvements: [], charts: [] });
    expect(empty.subarray(0, 5).toString()).toBe("%PDF-");
    const many = await renderReportPdf({
      ...base,
      latest: Array.from({ length: 14 }, (_, i) => latest(`/pagina-${i}`, i % 2 ? "mobile" : "desktop", 50 + i)),
      charts: Array.from({ length: 8 }, (_, i) => ({ routePath: `/pagina-${i}`, profile: "mobile" as const, points: pts(10 + i), ranges: [] })),
    });
    const pages = (many.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("el nombre de archivo es seguro y lleva la fecha", () => {
    expect(reportFilename(base)).toBe("informe-Acme-S-A-Tienda-nandu-20261103.pdf");
    expect(reportFilename({ ...base, clientName: "../../etc/passwd", projectName: "\"; rm -rf /" })).toMatch(/^informe-[A-Za-z0-9-]+-[A-Za-z0-9-]+-20261103\.pdf$/);
    expect(reportFilename({ ...base, clientName: "ñ", projectName: "***" })).toBe("informe-n-informe-20261103.pdf");
  });
});

describe("correo del informe", () => {
  it("saluda al contacto, nombra el periodo y enlaza el portal con el texto escapado", () => {
    const m = buildReportEmail({ contactName: "Ana", projectName: "Tienda <b>", days: 90, portalUrl: "https://app.test/c/tok/proj" });
    expect(m.subject).toBe("Informe de Tienda <b>");
    expect(m.text).toContain("Hola Ana,");
    expect(m.text).toContain("90 días");
    expect(m.text).toContain("https://app.test/c/tok/proj");
    expect(m.html).toContain("Tienda &lt;b&gt;");
    expect(m.html).not.toContain("Tienda <b>");
    expect(buildReportEmail({ contactName: null, projectName: "T", days: 7, portalUrl: "u" }).text).toMatch(/^Hola,/);
  });
});

describe("utilidades del informe", () => {
  it("las bandas de puntuación coinciden con el Design System", () => {
    expect(scoreBand(90).word).toBe("bueno");
    expect(scoreBand(89).word).toBe("mejorable");
    expect(scoreBand(50).word).toBe("mejorable");
    expect(scoreBand(49)).toEqual({ tone: "danger", word: "deficiente" });
  });
  it("los colores salen de tokens.json (tema claro)", () => {
    expect(lightToken("brand-deep")).toBe("#111827");
    expect(lightToken("primary")).toBe("#4D7C0F");
    expect(lightToken("no-existe")).toBe("#000000");
  });
});
