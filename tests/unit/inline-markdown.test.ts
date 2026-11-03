import { describe, expect, it } from "vitest";
import { middleTruncate, parseInline } from "@/server/domain/inline-markdown";

describe("parseInline", () => {
  it("separa texto, enlaces y código en orden", () => {
    expect(parseInline("Usa `width` y [más info](https://web.dev/x). Fin")).toEqual([
      { k: "text", v: "Usa " },
      { k: "code", v: "width" },
      { k: "text", v: " y " },
      { k: "link", text: "más info", url: "https://web.dev/x" },
      { k: "text", v: ". Fin" },
    ]);
  });
  it("solo acepta enlaces http(s): lo demás queda como texto", () => {
    const parts = parseInline("[x](javascript:alert(1)) y [y](data:text/html,hola)");
    expect(parts.every((p) => p.k === "text")).toBe(true);
    expect(parts.map((p) => (p as { v: string }).v).join("")).toContain("javascript:alert(1)");
  });
  it("no interpreta HTML y tolera cadenas vacías o sin marcas", () => {
    expect(parseInline("<b>hola</b>")).toEqual([{ k: "text", v: "<b>hola</b>" }]);
    expect(parseInline("")).toEqual([]);
    expect(parseInline("sin marcas")).toEqual([{ k: "text", v: "sin marcas" }]);
  });
  it("varios enlaces seguidos", () => {
    expect(parseInline("[a](https://a.test)[b](https://b.test)").map((p) => p.k)).toEqual(["link", "link"]);
  });
});

describe("middleTruncate", () => {
  it("no toca lo corto y acorta lo largo por el medio dejando el final", () => {
    expect(middleTruncate("corto", 10)).toBe("corto");
    const url = "https://example.com/assets/js/vendor/framework.min.js?v=123456789";
    const out = middleTruncate(url, 30);
    expect(out.length).toBe(30);
    expect(out.startsWith("https://")).toBe(true);
    expect(out.endsWith("123456789")).toBe(true);
    expect(out).toContain("…");
  });
});
