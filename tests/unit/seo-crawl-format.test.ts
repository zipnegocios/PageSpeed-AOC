import { describe, expect, it } from "vitest";
import { countDelta, formatEvidence, RUN_STATUS_LABEL, SEVERITY_LABEL } from "@/lib/seo-crawl-format";
import { byLanguage, ISSUE_CODES, SITE, type Evidence } from "@/server/domain/seo-crawl-rules";

describe("evidencia legible", () => {
  it("cada hallazgo con evidencia se explica con las cifras reales", () => {
    expect(formatEvidence("status_error", { status: 404, inSitemap: true })).toBe("Respondió con estado 404 · está en el sitemap");
    expect(formatEvidence("status_error", { status: 0, inSitemap: false })).toBe("Respondió con sin respuesta");
    expect(formatEvidence("redirect_chain", { hops: 3, to: "/nueva" })).toBe("3 saltos hasta /nueva");
    expect(formatEvidence("redirect_loop", { hops: 1 })).toBe("1 salto sin llegar a un destino");
    expect(formatEvidence("broken_link", { count: 7, from: ["/a", "/b"], status: 404 })).toBe("Respondió con estado 404 · la enlazan 7 páginas: /a, /b y 5 más");
    expect(formatEvidence("broken_link", { count: 1, from: ["/a"], status: 410 })).toBe("Respondió con estado 410 · la enlazan 1 página: /a");
    expect(formatEvidence("sitemap_url_redirected", { to: "/b" })).toBe("Redirige a /b");
    expect(formatEvidence("canonical_other_language", { canonical: "/en/a", expected: "es", found: "en" })).toContain("«en»");
    expect(formatEvidence("title_missing", { empty: true })).toBe("La etiqueta title está vacía");
    expect(formatEvidence("title_missing", { empty: false })).toBe("No tiene etiqueta title");
    expect(formatEvidence("title_length", { length: 1 })).toBe("1 carácter");
    expect(formatEvidence("description_long", { length: 200 })).toBe("200 caracteres");
    expect(formatEvidence("title_duplicate", { count: 3, also: ["/a", "/b"] })).toBe("Igual en 3 páginas: /a, /b");
    expect(formatEvidence("lang_mismatch", { lang: "es", expected: "en" })).toBe('lang="es", pero la ruta indica «en»');
    expect(formatEvidence("hreflang_not_reciprocal", { targets: ["/en"] })).toBe("Alternativas: /en");
    expect(formatEvidence("jsonld_missing_props", { missing: ["Product: offers|review", "Article: author, datePublished"] })).toBe("Falta: Product: offers|review; Article: author; datePublished");
    expect(formatEvidence("jsonld_invalid", { blocks: 2 })).toBe("2 bloques inválidos");
  });

  it("los hallazgos sin evidencia dan texto vacío y ninguno rompe con la evidencia vacía", () => {
    expect(formatEvidence("orphan_page", {})).toBe("");
    expect(formatEvidence("h1_missing", {})).toBe("");
    for (const code of ISSUE_CODES) expect(typeof formatEvidence(code, {} as Evidence)).toBe("string");
  });

  it("nunca imprime undefined ni NaN", () => {
    for (const code of ISSUE_CODES) {
      const text = formatEvidence(code, {});
      expect(text).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});

describe("variación del número de hallazgos", () => {
  it("menos es mejor; sin base no hay variación", () => {
    expect(countDelta(3, 5)).toMatchObject({ direction: "down", verdict: "better", text: "2 hallazgos" });
    expect(countDelta(6, 5)).toMatchObject({ direction: "up", verdict: "worse", text: "1 hallazgo" });
    expect(countDelta(4, 4)).toMatchObject({ verdict: "same" });
    expect(countDelta(4, null)).toBeNull();
  });

  it("etiquetas en español", () => {
    expect(SEVERITY_LABEL.warning).toBe("Aviso");
    expect(RUN_STATUS_LABEL.partial).toBe("Parcial");
  });
});

describe("filtro por idioma", () => {
  const issues = [
    { page: "/a", lang: "es" },
    { page: "/en/a", lang: "en" },
    { page: "/otra", lang: null },
    { page: SITE, lang: null },
  ];
  it("todos, un idioma, y las páginas sin idioma sin los hallazgos del sitio", () => {
    expect(byLanguage(issues, null)).toHaveLength(4);
    expect(byLanguage(issues, "en")).toEqual([{ page: "/en/a", lang: "en" }]);
    expect(byLanguage(issues, "none")).toEqual([{ page: "/otra", lang: null }]);
    expect(byLanguage(issues, "fr")).toEqual([]);
  });
});
