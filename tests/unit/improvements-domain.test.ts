import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatImpact, hasGlossary, plainImprovement } from "@/server/domain/improvement-glossary";
import { MAX_ITEMS_PER_CATEGORY, extractImprovements, isAuditImprovements, isLegacyImprovements } from "@/server/domain/improvements";
import type { LhrLike } from "@/server/domain/score-extraction";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as LhrLike;

const cat = (group: string, ids: string[], weight = 0) => ({ title: "x", score: 0.5, auditRefs: ids.map((id) => ({ id, weight, group })) });

describe("lo que hay que mejorar, extraído de Lighthouse", () => {
  it("rendimiento: diagnósticos e «insights» que fallan, por ahorro de tiempo; las métricas y lo oculto no entran", () => {
    const lhr: LhrLike = {
      categories: {
        performance: {
          title: "Rendimiento",
          score: 0.5,
          auditRefs: [
            { id: "largest-contentful-paint", weight: 25, group: "metrics" },
            { id: "unused-javascript", weight: 0, group: "diagnostics" },
            { id: "render-blocking-insight", weight: 0, group: "insights" },
            { id: "image-delivery-insight", weight: 0, group: "insights" },
            { id: "ya-cumple", weight: 0, group: "diagnostics" },
            { id: "oculto", weight: 0, group: "hidden" },
            { id: "no-aplica", weight: 0, group: "diagnostics" },
          ],
        },
      },
      audits: {
        "largest-contentful-paint": { title: "LCP", score: 0.2, scoreDisplayMode: "numeric" },
        "unused-javascript": { title: "Reduce el JavaScript sin usar", score: 0.4, scoreDisplayMode: "metricSavings", details: { type: "opportunity", overallSavingsMs: 450, overallSavingsBytes: 90_000 } },
        "render-blocking-insight": { title: "Bloquea", score: 0, scoreDisplayMode: "metricSavings", metricSavings: { FCP: 900, LCP: 1900 } } as never,
        "image-delivery-insight": { title: "Imágenes", score: 0.5, scoreDisplayMode: "metricSavings", details: { type: "table", items: [{}, {}, {}] } },
        "ya-cumple": { title: "Cumple", score: 1, scoreDisplayMode: "metricSavings" },
        oculto: { title: "Oculto", score: 0, scoreDisplayMode: "numeric" },
        "no-aplica": { title: "N/A", score: null, scoreDisplayMode: "notApplicable" },
      },
    };
    const perf = extractImprovements(lhr).categories.performance!;
    expect(perf.map((i) => i.id)).toEqual(["render-blocking-insight", "unused-javascript", "image-delivery-insight"]);
    expect(perf[0]!.impact).toEqual({ ms: 1900 });
    expect(perf[1]!.impact).toEqual({ ms: 450, bytes: 90_000 });
    expect(perf[2]!.impact).toEqual({ count: 3 });
  });

  it("accesibilidad, SEO y buenas prácticas: las que suman a la nota, por peso; las binarias fallan con menos de 1", () => {
    const lhr: LhrLike = {
      categories: {
        accessibility: { title: "A", score: 0.8, auditRefs: [{ id: "a1", weight: 3 }, { id: "a2", weight: 10 }, { id: "a3", weight: 0 }, { id: "a4", weight: 7 }] },
        seo: { title: "S", score: 0.9, auditRefs: [{ id: "s1", weight: 1 }] },
      },
      audits: {
        a1: { title: "Uno", score: 0, scoreDisplayMode: "binary", details: { items: [{}] } },
        a2: { title: "Dos", score: 0, scoreDisplayMode: "binary", details: { items: [{}, {}] } },
        a3: { title: "Tres (sin peso)", score: 0, scoreDisplayMode: "binary" },
        a4: { title: "Cuatro", score: 1, scoreDisplayMode: "binary" },
        s1: { title: "SEO uno", score: 0.89, scoreDisplayMode: "numeric" },
      },
    };
    const out = extractImprovements(lhr).categories;
    expect(out.accessibility!.map((i) => i.id)).toEqual(["a2", "a1"]);
    expect(out.seo!.map((i) => i.id)).toEqual(["s1"]);
    expect(out["best-practices"]).toBeUndefined();
  });

  it("guarda hasta 50 por rubro (antes 10), de más a menos importante, sin perder las que pasaban del décimo lugar", () => {
    const ids = Array.from({ length: 63 }, (_, i) => `y${i}`);
    const lhr: LhrLike = { categories: { accessibility: cat("", ids, 1) }, audits: Object.fromEntries(ids.map((id) => [id, { title: id, score: 0, scoreDisplayMode: "binary" }])) };
    const out = extractImprovements(lhr).categories.accessibility!;
    expect(out).toHaveLength(50);
    expect(out.map((i) => i.id).slice(0, 12)).toEqual(ids.slice(0, 12));
    expect(MAX_ITEMS_PER_CATEGORY).toBe(50);
  });

  it("recorta a `limit` por rubro y devuelve vacío si no hay nada que mejorar", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `x${i}`);
    const lhr: LhrLike = { categories: { accessibility: cat("", ids, 1) }, audits: Object.fromEntries(ids.map((id) => [id, { title: id, score: 0, scoreDisplayMode: "binary" }])) };
    expect(extractImprovements(lhr).categories.accessibility).toHaveLength(15);
    expect(extractImprovements(lhr, 3).categories.accessibility).toHaveLength(3);
    expect(extractImprovements({ categories: {}, audits: {} })).toEqual({ v: 2, categories: {} });
  });

  it("con un resultado real de Lighthouse 13 encuentra lo que falla y es JSON guardable", () => {
    const out = extractImprovements(fixture("lhr-viewer.json"));
    expect(out.categories.accessibility!.map((i) => i.id)).toContain("landmark-one-main");
    expect(out.categories["best-practices"]!.map((i) => i.id)).toContain("errors-in-console");
    expect(out.categories.performance!.map((i) => i.id)).toContain("unsized-images");
    expect(isAuditImprovements(JSON.parse(JSON.stringify(out)))).toBe(true);
    expect(isAuditImprovements({ v: 1, categories: {} })).toBe(false); // la versión anterior (10 por rubro) se recalcula
    expect(isLegacyImprovements({ v: 1, categories: {} })).toBe(true);
    expect(isLegacyImprovements({ v: 2, categories: {} })).toBe(false);
    expect(isAuditImprovements(null)).toBe(false);
  });
});

describe("glosario e impacto", () => {
  it("la frase llana sale del glosario y, sin él, del título de Lighthouse", () => {
    expect(plainImprovement({ id: "color-contrast", title: "Contraste" })).toMatch(/poco contraste/);
    expect(plainImprovement({ id: "algo-nuevo-de-lighthouse", title: "Título en español" })).toBe("Título en español");
    expect(hasGlossary("unused-javascript")).toBe(true);
    expect(hasGlossary("algo-nuevo-de-lighthouse")).toBe(false);
  });

  it("cubre las comprobaciones que fallan en el resultado de ejemplo", () => {
    const out = extractImprovements(fixture("lhr-viewer.json"));
    for (const items of Object.values(out.categories)) for (const it of items!) expect(hasGlossary(it.id), it.id).toBe(true);
  });

  it("el impacto: tiempo, luego peso, luego elementos; en español", () => {
    expect(formatImpact({ ms: 1900 })).toBe("≈ 1,9 s");
    expect(formatImpact({ ms: 340 })).toBe("≈ 340 ms");
    expect(formatImpact({ ms: 1900, bytes: 5, count: 2 })).toBe("≈ 1,9 s");
    expect(formatImpact({ bytes: 120 * 1024 })).toBe("≈ 120 KiB");
    expect(formatImpact({ bytes: 3 * 1024 * 1024 })).toBe("≈ 3 MiB");
    expect(formatImpact({ count: 1 })).toBe("1 elemento");
    expect(formatImpact({ count: 3 })).toBe("3 elementos");
    expect(formatImpact(null)).toBe("");
    expect(formatImpact({})).toBe("");
  });
});
