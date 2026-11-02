import { describe, expect, it } from "vitest";
import { DomainError } from "@/server/domain/errors";
import { normalizePath, routeUrl } from "@/server/domain/route-path";
import { isValidSlug, requireSlug, slugify } from "@/server/domain/slug";
import { generateMagicToken } from "@/server/auth/magic-token";

describe("slugify", () => {
  it("quita acentos, símbolos y recorta", () => {
    expect(slugify("Ñandú Café S.A.")).toBe("nandu-cafe-s-a");
    expect(slugify("  Hola   Mundo!! ")).toBe("hola-mundo");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(80))).toHaveLength(40);
  });
  it("no deja un guion al final al recortar", () => {
    const s = slugify("a".repeat(39) + " b");
    expect(s.endsWith("-")).toBe(false);
  });
  it("valida el formato exigido para el prefijo de R2", () => {
    expect(isValidSlug("acme-web")).toBe(true);
    for (const bad of ["", "a", "-acme", "acme-", "Acme", "acme web", "acme_web", "../etc", "a".repeat(41)]) {
      expect(isValidSlug(bad)).toBe(false);
    }
    expect(() => requireSlug("MAL")).toThrow(DomainError);
  });
});

describe("normalizePath", () => {
  it.each([
    ["/blog/", "/blog"],
    ["blog", "/blog"],
    ["//a///b//", "/a/b"],
    ["/", "/"],
    ["", null],
    ["https://acme.test/contacto?utm=1#x", "/contacto"],
    ["/precios?plan=pro", "/precios"],
    ["/con espacio", null],
    ["https://acme.test", "/"],
  ])("%j -> %j", (input, expected) => {
    if (expected === null) expect(() => normalizePath(input)).toThrow(DomainError);
    else expect(normalizePath(input)).toBe(expected);
  });
  it("limita el largo", () => {
    expect(() => normalizePath("/" + "a".repeat(600))).toThrow(DomainError);
  });
  it("routeUrl junta origen y ruta", () => {
    expect(routeUrl("https://acme.test", "/blog")).toBe("https://acme.test/blog");
    expect(routeUrl("https://acme.test", "/")).toBe("https://acme.test/");
  });
});

describe("generateMagicToken", () => {
  it("genera tokens base64url de 43 caracteres, distintos cada vez", () => {
    const a = generateMagicToken();
    const b = generateMagicToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});
