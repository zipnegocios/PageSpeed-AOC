import { describe, expect, it } from "vitest";
import { isDomainError } from "@/server/domain/errors";
import { classifyPath, langLabel, languageSegment, marketConflict, NO_LANG, normalizeLang, normalizePrefix, orderMarkets, parseLangParam, ROOT } from "@/server/domain/seo-markets";

const invalid = (fn: () => unknown, text: RegExp) => {
  try {
    fn();
  } catch (err) {
    expect(isDomainError(err)).toBe(true);
    expect((err as Error).message).toMatch(text);
    return;
  }
  throw new Error("no lanzó");
};

describe("código de idioma", () => {
  it("acepta 2 o 3 letras y lo pasa a minúsculas", () => {
    expect(normalizeLang("es")).toBe("es");
    expect(normalizeLang("  EN ")).toBe("en");
    expect(normalizeLang("fil")).toBe("fil");
  });

  it("rechaza el país y lo que no es un código, explicando por qué", () => {
    invalid(() => normalizeLang("es-MX"), /sin el país/);
    invalid(() => normalizeLang("pt-br"), /sin el país/);
    invalid(() => normalizeLang("e"), /2 o 3 letras/);
    invalid(() => normalizeLang("español"), /2 o 3 letras/);
    invalid(() => normalizeLang(""), /2 o 3 letras/);
  });
});

describe("prefijo de ruta", () => {
  it("acepta varias formas de escribirlo", () => {
    expect(normalizePrefix("es")).toBe("/es");
    expect(normalizePrefix("/es")).toBe("/es");
    expect(normalizePrefix("/ES/")).toBe("/es");
    expect(normalizePrefix("https://ejemplo.com/en-au/")).toBe("/en-au");
    expect(normalizePrefix("/blog/es")).toBe("/blog/es");
  });

  it("vacío o «/» es el idioma por defecto", () => {
    expect(normalizePrefix("")).toBe(ROOT);
    expect(normalizePrefix("/")).toBe(ROOT);
    expect(normalizePrefix("https://ejemplo.com/")).toBe(ROOT);
  });

  it("rechaza lo que no es una ruta de uno o dos tramos", () => {
    invalid(() => normalizePrefix("/a/b/c"), /como \/es o \/en/);
    invalid(() => normalizePrefix("/es?x=1"), /como \/es o \/en/);
    invalid(() => normalizePrefix("/es%25"), /como \/es o \/en/);
    invalid(() => normalizePrefix("https://"), /no es válida/);
  });
});

describe("conflictos", () => {
  const existing = [
    { lang: "es", prefix: ROOT },
    { lang: "en", prefix: "/en" },
  ];
  it("detecta idioma repetido, prefijo repetido y un segundo idioma por defecto", () => {
    expect(marketConflict(existing, { lang: "en", prefix: "/inglés" })).toBe("Ese idioma ya está declarado.");
    expect(marketConflict(existing, { lang: "pt", prefix: "/en" })).toBe("Ese prefijo ya lo usa otro idioma.");
    expect(marketConflict(existing, { lang: "pt", prefix: ROOT })).toBe("Ya hay un idioma por defecto (sin prefijo).");
    expect(marketConflict(existing, { lang: "pt", prefix: "/pt" })).toBeNull();
  });
});

describe("clasificación de rutas", () => {
  const markets = [
    { lang: "es", prefix: ROOT },
    { lang: "en", prefix: "/en" },
    { lang: "pt", prefix: "/pt" },
  ];

  it("ordena del prefijo más largo al más corto y deja el idioma por defecto al final", () => {
    expect(orderMarkets([{ lang: "es", prefix: ROOT }, { lang: "en", prefix: "/en" }, { lang: "ca", prefix: "/es/cat" }]).map((m) => m.lang)).toEqual(["ca", "en", "es"]);
  });

  it("asigna cada página a su idioma, sin confundir /en con /english", () => {
    expect(classifyPath("/en", markets)).toBe("en");
    expect(classifyPath("/en/services", markets)).toBe("en");
    expect(classifyPath("/pt/precos/", markets)).toBe("pt");
    expect(classifyPath("/english", markets)).toBe("es");
    expect(classifyPath("/", markets)).toBe("es");
    expect(classifyPath("/contacto", markets)).toBe("es");
  });

  it("acepta URLs completas, mayúsculas, parámetros y ancla", () => {
    expect(classifyPath("https://ejemplo.com/EN/Services?x=1#a", markets)).toBe("en");
  });

  it("el prefijo más largo gana", () => {
    const m = [{ lang: "es", prefix: "/es" }, { lang: "ca", prefix: "/es/cat" }];
    expect(classifyPath("/es/cat/hola", m)).toBe("ca");
    expect(classifyPath("/es/hola", m)).toBe("es");
  });

  it("sin idioma por defecto, lo que no encaja queda sin idioma", () => {
    const m = [{ lang: "es", prefix: "/es" }, { lang: "en", prefix: "/en" }];
    expect(classifyPath("/blog", m)).toBeNull();
    expect(classifyPath("/", m)).toBeNull();
    expect(classifyPath("/es/x", [])).toBeNull();
  });
});

describe("parámetro de idioma, nombres y detección", () => {
  const withDefault = [{ lang: "es", prefix: ROOT }, { lang: "en", prefix: "/en" }];
  const withoutDefault = [{ lang: "es", prefix: "/es" }, { lang: "en", prefix: "/en" }];

  it("solo acepta idiomas declarados, o «sin idioma» cuando no hay uno por defecto", () => {
    expect(parseLangParam("en", withDefault)).toBe("en");
    expect(parseLangParam("fr", withDefault)).toBeUndefined();
    expect(parseLangParam(undefined, withDefault)).toBeUndefined();
    expect(parseLangParam(NO_LANG, withDefault)).toBeUndefined();
    expect(parseLangParam(NO_LANG, withoutDefault)).toBe(NO_LANG);
    expect(parseLangParam(NO_LANG, [])).toBeUndefined();
  });

  it("da el nombre en español del idioma", () => {
    expect(langLabel("es")).toBe("Español");
    expect(langLabel("pt")).toBe("Portugués");
    expect(langLabel(NO_LANG)).toBe("Sin idioma");
    expect(langLabel("xx")).toBe("XX");
  });

  it("reconoce el prefijo de idioma de 2 letras en el primer tramo de una ruta", () => {
    expect(languageSegment("/es/precios")).toBe("/es");
    expect(languageSegment("/EN-AU")).toBe("/en-au");
    expect(languageSegment("/faq/x")).toBeNull();
    expect(languageSegment("/blog")).toBeNull();
    expect(languageSegment("/")).toBeNull();
  });
});
