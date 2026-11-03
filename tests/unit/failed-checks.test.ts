import { describe, expect, it } from "vitest";
import failing from "../fixtures/lhr-failing.json";
import minimal from "../fixtures/lhr-minimal.json";
import { failedChecks, plainDescription } from "@/server/domain/failed-checks";
import type { LhrLike } from "@/server/domain/score-extraction";

const byCategory = (lhr: unknown) => Object.fromEntries(failedChecks(lhr as LhrLike).map((c) => [c.category, c]));

describe("failedChecks", () => {
  it("lista, por categoría, lo que no se cumple en un resultado real de Lighthouse", () => {
    const c = byCategory(failing);
    expect(c.accessibility!.checks.map((x) => x.id)).toEqual(["landmark-one-main"]);
    expect(c["best-practices"]!.checks.map((x) => x.id)).toEqual(["errors-in-console"]);
    expect(c.seo!.checks.map((x) => x.id).sort()).toEqual(["is-crawlable", "meta-description"]);
  });

  it("en rendimiento solo salen métricas por debajo de 0,9, de la peor a la mejor entre las de igual peso", () => {
    const perf = byCategory(failing).performance!;
    const ids = perf.checks.map((x) => x.id);
    expect(ids).toContain("largest-contentful-paint");
    expect(ids).toContain("cumulative-layout-shift");
    expect(ids).not.toContain("total-blocking-time"); // 0,9 justo: cumple
    expect(ids).not.toContain("first-contentful-paint"); // sin dato: se ignora
    expect(perf.checks[0]!.id).toBe("largest-contentful-paint"); // mayor peso primero
    expect(perf.checks[0]!.displayValue).toBe("4.1 s");
  });

  it("incluye el nombre en español de cada categoría y su puntuación 0-100", () => {
    const all = failedChecks(failing as LhrLike);
    expect(all.map((c) => c.label)).toEqual(["Rendimiento", "Accesibilidad", "SEO", "Buenas prácticas"]);
    expect(all.find((c) => c.category === "seo")!.score).toBe(69);
    expect(all.find((c) => c.category === "performance")!.score).toBe(62);
  });

  it("ordena por peso y recorta, informando cuántas fallan en total", () => {
    const seo = failedChecks(failing as LhrLike, 1).find((c) => c.category === "seo")!;
    expect(seo.checks).toHaveLength(1);
    expect(seo.failedCount).toBe(2);
    expect(seo.checks[0]!.weight).toBeGreaterThanOrEqual(1);
  });

  it("quita la sintaxis de enlaces y conserva la dirección de 'más información'", () => {
    const a11y = byCategory(failing).accessibility!.checks[0]!;
    expect(a11y.description).not.toContain("](");
    expect(a11y.description).not.toContain("[");
    expect(a11y.learnMoreUrl).toMatch(/^https:\/\/dequeuniversity\.com\//);
  });

  it("un resultado sin fallos devuelve las categorías vacías, y uno sin datos no devuelve nada", () => {
    for (const c of failedChecks(minimal as LhrLike)) expect(c.checks).toEqual([]);
    expect(failedChecks({})).toEqual([]);
  });

  it("ignora comprobaciones informativas, manuales o que no aplican aunque tengan peso", () => {
    const lhr: LhrLike = {
      categories: { seo: { score: 0.5, auditRefs: [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 0 }, { id: "d", weight: 1 }] } },
      audits: {
        a: { score: 0, scoreDisplayMode: "informative", title: "A" },
        b: { score: 0, scoreDisplayMode: "notApplicable", title: "B" },
        c: { score: 0, scoreDisplayMode: "binary", title: "C" }, // peso 0
        d: { score: 0, scoreDisplayMode: "manual", title: "D" },
      },
    };
    expect(failedChecks(lhr)[0]!.checks).toEqual([]);
  });
});

describe("plainDescription", () => {
  it.each([
    ["Texto. [Más información](https://a.test/x).", "Texto. Más información.", "https://a.test/x"],
    ["Usa `alt` en [imágenes](https://a.test/1) y [vídeos](https://a.test/2).", "Usa alt en imágenes y vídeos.", "https://a.test/1"],
    ["Sin enlaces", "Sin enlaces", null],
    ["", "", null],
  ])("%j", (input, text, url) => {
    expect(plainDescription(input)).toEqual({ text, url });
  });

  it("no convierte enlaces que no son http(s)", () => {
    expect(plainDescription("[x](javascript:alert(1))").url).toBeNull();
  });
});
