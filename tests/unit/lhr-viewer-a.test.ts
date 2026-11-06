import { describe, expect, it } from "vitest";
import agentic from "../fixtures/lhr-agentic.json";
import minimal from "../fixtures/lhr-minimal.json";
import { categoryFraction, showAsPassed } from "@/server/domain/agentic";
import { redactLhr } from "@/server/domain/lhr-redact";
import { extractResults, type LhrLike } from "@/server/domain/score-extraction";
import { REPORT_HEADERS, localizeLhr, parseLocale, renderOfficialReport } from "@/server/report/lighthouse-report";

const lhr = agentic as unknown as LhrLike & Record<string, unknown>;

describe("navegación con agentes", () => {
  it("cuenta superadas sobre totales como el informe de Lighthouse", () => {
    // agent-accessibility-tree y CLS pasan; ard-schema falla; webmcp-*/llms-txt no aplican; webmcp-registered-tools es informativa.
    expect(categoryFraction(lhr)).toEqual({ passed: 2, total: 3 });
  });
  it("ignora ocultas, manuales, no aplicables e informativas, y sin categoría da null", () => {
    expect(categoryFraction(minimal as unknown as LhrLike)).toBeNull();
    const synthetic: LhrLike = {
      categories: { "agentic-browsing": { auditRefs: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e", group: "hidden" }, { id: "f" }] } },
      audits: {
        a: { score: 1, scoreDisplayMode: "binary" },
        b: { score: 0, scoreDisplayMode: "binary" },
        c: { score: null, scoreDisplayMode: "notApplicable" },
        d: { score: null, scoreDisplayMode: "manual" },
        e: { score: 0, scoreDisplayMode: "binary" },
        f: { score: 0.95, scoreDisplayMode: "numeric" },
      },
    };
    expect(categoryFraction(synthetic)).toEqual({ passed: 2, total: 3 });
  });
  it("showAsPassed sigue la regla de Lighthouse", () => {
    expect(showAsPassed({ scoreDisplayMode: "manual" })).toBe(true);
    expect(showAsPassed({ scoreDisplayMode: "notApplicable" })).toBe(true);
    expect(showAsPassed({ scoreDisplayMode: "informative", score: 1 })).toBe(false);
    expect(showAsPassed({ scoreDisplayMode: "error" })).toBe(false);
    expect(showAsPassed({ scoreDisplayMode: "numeric", score: 0.9 })).toBe(true);
    expect(showAsPassed({ scoreDisplayMode: "binary", score: 0.89 })).toBe(false);
  });
  it("el extractor la guarda y es null en resultados sin la categoría", () => {
    const r = extractResults(lhr);
    expect(r.ok && [r.metrics.agenticPassed, r.metrics.agenticTotal]).toEqual([2, 3]);
    const old = extractResults(minimal as unknown as LhrLike);
    expect(old.ok && [old.metrics.agenticPassed, old.metrics.agenticTotal]).toEqual([null, null]);
  });
});

describe("idioma de los textos de Lighthouse", () => {
  const title = (l: Record<string, unknown>) => (l.audits as Record<string, { title: string }>)["landmark-one-main"]?.title ?? (l.audits as Record<string, { title: string }>)["is-on-https"]?.title;
  it("parseLocale usa español salvo que pidan inglés", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("es")).toBe("es");
    expect(parseLocale("fr")).toBe("es");
    expect(parseLocale(undefined)).toBe("es");
  });
  it("traduce un resultado guardado al español y vuelve al inglés sin alterar el original", () => {
    const original = JSON.stringify(lhr);
    const es = localizeLhr(lhr, "es");
    expect((es.categories as Record<string, { title: string }>).performance?.title).toBe("Rendimiento");
    expect((es.categories as Record<string, { title: string }>)["best-practices"]?.title).toBe("Prácticas recomendadas");
    expect(title(es)).not.toBe(title(lhr));
    expect(es.audits).toBeDefined();
    const en = localizeLhr(es, "en");
    expect((en.categories as Record<string, { title: string }>).performance?.title).toBe("Performance");
    expect(title(en)).toBe(title(lhr));
    expect(JSON.stringify(lhr)).toBe(original);
  });
  it("sin información para traducir devuelve el resultado tal cual", () => {
    const bare = { audits: {}, categories: {} };
    expect(localizeLhr(bare, "es")).toBe(bare);
  });
});

describe("informe oficial", () => {
  it("redactado, el informe no lleva ninguna imagen JPEG de la página", () => {
    expect(renderOfficialReport(lhr, "es")).toContain("data:image/jpeg;base64,/9j/");
    expect(renderOfficialReport(redactLhr(lhr), "es")).not.toContain("data:image/jpeg;base64,/9j/");
  });
  it("siempre se muestra con el tema oscuro propio de Lighthouse, como el resto de la aplicación", () => {
    const html = renderOfficialReport(lhr, "es");
    expect(html).toContain("lh-dark");
    expect(html.indexOf("lh-dark")).toBeLessThan(html.indexOf("</head>"));
  });
  it("se genera autocontenido, en el idioma pedido y sin las herramientas que sacan datos de la aplicación", () => {
    const es = renderOfficialReport(lhr, "es");
    expect(es).toMatch(/<!doctype html>/i);
    expect(es).not.toMatch(/<script[^>]+src=/i);
    expect(es).toContain("Rendimiento");
    expect(es).toContain("lh-tools");
    expect(es).toMatch(/\.lh-tools[^}]*display:none!important/);
    expect(es).toMatch(/lh-report-icon--treemap/);
    const en = renderOfficialReport(lhr, "en");
    expect(en).toContain("Performance");
    expect(en).not.toContain("Prácticas recomendadas");
  });
  it("sus cabeceras lo aíslan: sandbox sin mismo origen, sin red y solo enmarcable por la aplicación", () => {
    const csp = REPORT_HEADERS["Content-Security-Policy"]!;
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(REPORT_HEADERS["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(REPORT_HEADERS["Cache-Control"]).toContain("no-store");
  });
});

describe("redacción para el cliente", () => {
  const withEvidence = {
    audits: {
      "final-screenshot": { details: { type: "screenshot", data: "data:image/jpeg;base64,AAAA" } },
      "screenshot-thumbnails": { details: { type: "filmstrip" } },
      "unsized-images": { details: { items: [{ node: { type: "node", selector: "body > img", snippet: "<img src=x data-user='ana'>", nodeLabel: "Hola, Ana Pérez" } }] } },
      "is-on-https": { details: { items: [{ url: "http://a.test" }] } },
    },
    fullPageScreenshot: { screenshot: { data: "data:image/jpeg;base64,BBBB" }, nodes: {} },
    finalUrl: "https://a.test/cuenta",
  };
  it("quita capturas, fragmentos de HTML y textos de elementos, y no toca el original", () => {
    const before = JSON.stringify(withEvidence);
    const out = redactLhr(withEvidence) as typeof withEvidence & { audits: Record<string, unknown> };
    expect((out.audits["final-screenshot"] as { details?: unknown }).details).toBeUndefined();
    expect((out.audits["screenshot-thumbnails"] as { details?: unknown }).details).toBeUndefined();
    expect((out as { fullPageScreenshot?: unknown }).fullPageScreenshot).toBeUndefined();
    const text = JSON.stringify(out);
    expect(text).not.toContain("data-user");
    expect(text).not.toContain("Ana Pérez");
    expect(text).toContain("body > img");
    expect(text).toContain("http://a.test");
    expect(JSON.stringify(withEvidence)).toBe(before);
  });
});
