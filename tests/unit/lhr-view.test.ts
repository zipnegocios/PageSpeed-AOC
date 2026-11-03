import { describe, expect, it } from "vitest";
import real from "../fixtures/lhr-viewer.json";
import agentic from "../fixtures/lhr-agentic.json";
import {
  auditStatus, buildCategoryView, buildEvidence, buildSummary, detailsView, finalImage, fullPageImage, scriptItems, type Lhr,
} from "@/server/domain/lhr-view";
import { localizeLhr } from "@/server/report/lighthouse-report";
import { squarify } from "@/server/domain/treemap";

const lhr = localizeLhr(real as unknown as Lhr, "es");
const lhrAgentic = localizeLhr(agentic as unknown as Lhr, "es");

describe("estado de una auditoría", () => {
  it.each([
    [{ scoreDisplayMode: "binary", score: 1 }, "pass"],
    [{ scoreDisplayMode: "numeric", score: 0.9 }, "pass"],
    [{ scoreDisplayMode: "numeric", score: 0.89 }, "average"],
    [{ scoreDisplayMode: "numeric", score: 0.5 }, "average"],
    [{ scoreDisplayMode: "numeric", score: 0.49 }, "fail"],
    [{ scoreDisplayMode: "binary", score: 0 }, "fail"],
    [{ scoreDisplayMode: "binary", score: null }, "fail"],
    [{ scoreDisplayMode: "informative", score: null }, "informative"],
    [{ scoreDisplayMode: "notApplicable" }, "notApplicable"],
    [{ scoreDisplayMode: "manual" }, "manual"],
    [{ scoreDisplayMode: "error" }, "error"],
    [{ scoreDisplayMode: "metricSavings", score: 0.5 }, "average"],
  ])("%j → %s", (audit, expected) => {
    expect(auditStatus(audit)).toBe(expected);
  });
});

describe("categoría de rendimiento", () => {
  const perf = buildCategoryView(lhr, "performance", { locale: "es" })!;
  it("trae las métricas con su valoración y los grupos en el orden de Lighthouse", () => {
    expect(perf.title).toBe("Rendimiento");
    expect(perf.score).toBe(100);
    expect(perf.metrics.map((m) => m.acronym)).toEqual(expect.arrayContaining(["FCP", "LCP", "TBT", "CLS"]));
    expect(perf.metrics.every((m) => ["pass", "average", "fail"].includes(m.rating) && m.displayValue !== "")).toBe(true);
    const ids = perf.sections.map((s) => s.id);
    expect(ids.indexOf("diagnostics")).toBeGreaterThanOrEqual(0);
    expect(perf.sections.find((s) => s.id === "diagnostics")!.audits.some((a) => a.id === "unsized-images")).toBe(true);
  });
  it("separa las aprobadas y no repite una auditoría", () => {
    expect(perf.passed.length).toBeGreaterThan(5);
    const everywhere = [...perf.sections.flatMap((s) => s.audits), ...perf.passed, ...perf.notApplicable, ...perf.manual].map((a) => a.id);
    expect(new Set(everywhere).size).toBe(everywhere.length);
    expect(perf.passed.every((a) => a.status === "pass")).toBe(true);
    expect(perf.sections.flatMap((s) => s.audits).every((a) => ["fail", "average", "informative", "error"].includes(a.status))).toBe(true);
  });
  it("ordena lo que falla primero y filtra por métrica como el informe", () => {
    const diag = perf.sections.find((s) => s.id === "diagnostics")!.audits;
    const ranks = diag.map((a) => ({ fail: 0, average: 1, error: 2, informative: 3 })[a.status as "fail"] ?? 9);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const cls = buildCategoryView(lhr, "performance", { locale: "es", metric: "CLS" })!;
    const shown = cls.sections.flatMap((s) => s.audits);
    expect(shown.every((a) => a.metricSavings.CLS !== undefined)).toBe(true);
    expect(shown.length).toBeLessThan(perf.sections.flatMap((s) => s.audits).length);
    expect(buildCategoryView(lhr, "performance", { locale: "es", metric: "XXX" })!.sections.flatMap((s) => s.audits).length).toBe(perf.sections.flatMap((s) => s.audits).length);
  });
});

describe("otras categorías", () => {
  it("accesibilidad agrupa por tema, con la comprobación fallida y su elemento", () => {
    const a11y = buildCategoryView(lhr, "accessibility", { locale: "es" })!;
    const failing = a11y.sections.flatMap((s) => s.audits).find((a) => a.id === "landmark-one-main")!;
    expect(failing.status).toBe("fail");
    expect(failing.details?.t).toBe("table");
    const group = a11y.sections.find((s) => s.audits.includes(failing))!;
    expect(group.title).not.toBe("");
    expect(a11y.score).toBe(95);
  });
  it("muestra los elementos con su selector y fragmento", () => {
    const a11y = buildCategoryView(lhr, "accessibility", { locale: "es" })!;
    const d = a11y.sections.flatMap((s) => s.audits).find((a) => a.id === "landmark-one-main")!.details!;
    if (d.t !== "table") throw new Error("se esperaba una tabla");
    const cell = d.rows[0]!.cells.node!;
    expect(cell).toMatchObject({ k: "node", selector: "html", lhId: "1-0-HTML" });
    expect((cell as { snippet: string }).snippet).toContain("<html");
  });
  it("agentes es una fracción, no una nota, con sus grupos", () => {
    const ag = buildCategoryView(lhrAgentic, "agentic-browsing", { locale: "es" })!;
    expect(ag.score).toBeNull();
    expect(ag.fraction).toEqual({ passed: 2, total: 3 });
    const groupIds = [...ag.sections.map((s) => s.id), ...ag.passed.map((a) => a.group)];
    expect(groupIds.some((g) => /agent|webmcp/.test(String(g)))).toBe(true);
    expect(ag.notApplicable.length).toBeGreaterThan(0);
  });
  it("una categoría inexistente devuelve null", () => {
    expect(buildCategoryView(lhr, "no-existe", { locale: "es" })).toBeNull();
    expect(buildCategoryView(lhr, "agentic-browsing", { locale: "es" })).toBeNull(); // la medición antigua no la tiene
  });
});

describe("detalles", () => {
  it("tabla con valores tipados: bytes, tiempos, URL y código", () => {
    const d = detailsView(
      { type: "table", headings: [{ key: "url", valueType: "url", label: "URL" }, { key: "b", valueType: "bytes", label: "Tamaño" }, { key: "t", valueType: "ms", label: "Tiempo" }, { key: "c", valueType: "code", label: "Código" }],
        items: [{ url: "https://a.test/x.js", b: 2048, t: 1500, c: "foo()" }] }, "es");
    if (d?.t !== "table") throw new Error("tabla");
    expect(d.headings.map((h) => h.right)).toEqual([false, true, true, false]);
    const c = d.rows[0]!.cells;
    expect(c.url).toEqual({ k: "url", url: "https://a.test/x.js", label: "https://a.test/x.js" });
    expect(c.b).toEqual({ k: "num", v: "2 KiB", unit: "bytes" });
    expect(c.t).toEqual({ k: "num", v: "1,5 s", unit: "ms" });
    expect(c.c).toEqual({ k: "code", v: "foo()" });
  });
  it("sub-filas, límite de 50 filas y conteo de lo oculto", () => {
    const items = Array.from({ length: 70 }, (_, i) => ({ u: `u${i}`, subItems: i === 0 ? { type: "subitems", items: [{ reason: "porque sí" }] } : undefined }));
    const d = detailsView({ type: "table", headings: [{ key: "u", valueType: "text", label: "U", subItemsHeading: { key: "reason", valueType: "text" } }], items }, "es");
    if (d?.t !== "table") throw new Error("tabla");
    expect(d.rows).toHaveLength(50);
    expect(d.hidden).toBe(20);
    expect(d.rows[0]!.sub[0]!.cells.u).toEqual({ k: "text", v: "porque sí" });
  });
  it("lista, sección, lista de control y árbol de red", () => {
    const d = detailsView(
      { type: "list", items: [
        { type: "list-section", title: "Cadena", value: { type: "network-tree", chains: { a: { url: "https://a.test/", navStartToEndTime: 54, transferSize: 547, isLongest: true, children: { b: { url: "https://a.test/app.js", navStartToEndTime: 90, transferSize: 4096, children: {} } } } } } },
        { type: "checklist", items: { x: { label: "Sin redirecciones", value: true }, y: { label: "Compresión", value: false } } },
        { type: "node", lhId: "n1", selector: "body > h1", snippet: "<h1>", nodeLabel: "Hola" },
      ] }, "es");
    if (d?.t !== "list") throw new Error("lista");
    const [section, checklist, node] = d.items;
    expect(section).toMatchObject({ t: "section", title: "Cadena" });
    const tree = (section as { value: { t: string; nodes: Array<{ children: unknown[]; time: string; size: string }> } }).value;
    expect(tree.t).toBe("tree");
    expect(tree.nodes[0]!.children).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({ time: "54 ms", size: "0,5 KiB" });
    expect(checklist).toEqual({ t: "checklist", items: [{ label: "Sin redirecciones", ok: true }, { label: "Compresión", ok: false }] });
    expect(node).toMatchObject({ t: "node", cell: { selector: "body > h1", lhId: "n1" } });
  });
  it("lo que no se dibuja aquí (capturas, datos de depuración, mapa) y lo vacío dan null", () => {
    for (const d of [{ type: "screenshot" }, { type: "filmstrip", items: [] }, { type: "debugdata", items: [] }, { type: "treemap-data", nodes: [] }, { type: "table", headings: [], items: [] }, { type: "list", items: [] }, null, undefined, "x"]) {
      expect(detailsView(d, "es")).toBeNull();
    }
  });
  it("números con el formato del idioma", () => {
    const num = (locale: "es" | "en") => {
      const d = detailsView({ type: "table", headings: [{ key: "b", valueType: "bytes", label: "B" }], items: [{ b: 1536 }] }, locale);
      return d?.t === "table" ? (d.rows[0]!.cells.b as { v: string }).v : "";
    };
    expect(num("es")).toBe("1,5 KiB");
    expect(num("en")).toBe("1.5 KiB");
  });
});

describe("resumen y entorno", () => {
  const sum = buildSummary(lhr, "es");
  it("lista las categorías con sus notas y la captura final", () => {
    expect(sum.categories.map((c) => c.id)).toEqual(["performance", "accessibility", "best-practices", "seo"]);
    expect(sum.categories[0]).toMatchObject({ score: 100, fraction: null });
    expect(sum.finalScreenshot).toMatch(/^data:image\//);
    expect(sum.filmstrip.length).toBeGreaterThan(0);
  });
  it("describe el entorno como PageSpeed Insights", () => {
    const env = Object.fromEntries(sum.environment.map((e) => [e.label, e.value]));
    expect(env.Dispositivo).toMatch(/Móvil emulado/);
    expect(env.Red).toContain("4G lenta");
    expect(env["Tipo de carga"]).toBe("Carga inicial de la página");
    expect(env.Navegador).toMatch(/Chrome 153/);
    expect(sum.fetchedAt).toMatch(/UTC$/);
  });
  it("con agentes, la fracción va aparte y sin nota", () => {
    const s = buildSummary(lhrAgentic, "es");
    expect(s.categories.at(-1)).toMatchObject({ id: "agentic-browsing", score: null, fraction: { passed: 2, total: 3 } });
  });
});

describe("evidencias", () => {
  it("sitúa los elementos que fallan sobre la captura de página completa", () => {
    const ev = buildEvidence(lhr)!;
    expect(ev.width).toBe(412);
    const byId = Object.fromEntries(ev.audits.map((a) => [a.id, a]));
    expect(byId["landmark-one-main"]!.nodes[0]).toMatchObject({ n: 1, lhId: "1-0-HTML", selector: "html" });
    expect(byId["landmark-one-main"]!.nodes[0]!.rect.width).toBeGreaterThan(0);
    expect(ev.audits.every((a) => a.status === "fail" || a.status === "average")).toBe(true);
    expect(ev.audits.every((a) => a.nodes.every((n, i) => n.n === i + 1 && n.rect.width > 0 && n.rect.height > 0))).toBe(true);
  });
  it("sin captura de página completa no hay evidencias", () => {
    const { fullPageScreenshot: _omit, ...rest } = real as unknown as Lhr;
    void _omit;
    expect(buildEvidence(rest)).toBeNull();
  });
  it("las imágenes salen como bytes JPEG válidos y solo de datos reales", () => {
    const f = fullPageImage(lhr);
    // Lighthouse guarda la captura completa como WebP; el servidor devuelve el tipo que traiga.
    expect(["image/jpeg", "image/webp"]).toContain(f?.mime);
    const magic = f!.bytes.subarray(0, 4).toString("latin1");
    expect(f!.mime === "image/webp" ? magic === "RIFF" : f!.bytes.subarray(0, 2).toString("hex") === "ffd8").toBe(true);
    expect(finalImage(lhr)?.bytes.length).toBeGreaterThan(100);
    expect(fullPageImage({ fullPageScreenshot: { screenshot: { data: "data:text/html;base64,AAAA" } } } as never)).toBeNull();
    expect(fullPageImage({})).toBeNull();
  });
});

describe("mapa de scripts", () => {
  it("toma los scripts por tamaño y acota lo no usado", () => {
    const items = scriptItems({
      audits: { "script-treemap-data": { details: { nodes: [{ name: "a.js", resourceBytes: 100, unusedBytes: 30 }, { name: "b.js", resourceBytes: 300, unusedBytes: 999 }, { name: "vacío", resourceBytes: 0 }] } } },
    });
    expect(items).toEqual([{ name: "b.js", bytes: 300, unused: 300 }, { name: "a.js", bytes: 100, unused: 30 }]);
    expect(scriptItems(lhr)).toEqual([]);
  });
  it("squarify: las áreas son proporcionales, llenan el espacio y no se salen", () => {
    const rects = squarify([{ name: "a", value: 6 }, { name: "b", value: 6 }, { name: "c", value: 4 }, { name: "d", value: 3 }, { name: "e", value: 2 }, { name: "f", value: 2 }, { name: "g", value: 1 }]);
    expect(rects).toHaveLength(7);
    const area = (r: { w: number; h: number }) => r.w * r.h;
    expect(rects.reduce((s, r) => s + area(r), 0)).toBeCloseTo(10000, 3);
    const total = 24;
    for (const r of rects) {
      expect(area(r)).toBeCloseTo((r.value / total) * 10000, 3);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-9);
    }
    expect(squarify([])).toEqual([]);
    expect(squarify([{ name: "x", value: 0 }, { name: "y", value: -3 }])).toEqual([]);
    expect(squarify([{ name: "solo", value: 5 }])).toEqual([{ name: "solo", value: 5, x: 0, y: 0, w: 100, h: 100 }]);
  });
});
