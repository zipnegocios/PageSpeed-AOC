import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, isPlausibleApiKey, parseBearer } from "@/server/auth/api-key";
import { ALL_TOOLS, AUDIT_TOOLS, CONFIG_TOOLS, PRESETS, READ_TOOLS, presetOf, scopesForPreset } from "@/server/domain/mcp-scopes";

describe("claves de API", () => {
  it("genera claves únicas con prefijo y forma reconocible, y su hash es estable", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
    expect(isPlausibleApiKey(a)).toBe(true);
    expect(a).toMatch(/^aoc_[A-Za-z0-9_-]{43}$/);
    expect(hashApiKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).not.toBe(hashApiKey(b));
    expect(hashApiKey(a)).not.toContain(a.slice(4));
  });
  it("descarta lo que no parece una clave", () => {
    for (const bad of ["", "aoc_", "aoc_corta", `aoc_${"x".repeat(44)}`, `xyz_${"x".repeat(43)}`, `aoc_${"!".repeat(43)}`]) {
      expect(isPlausibleApiKey(bad)).toBe(false);
    }
  });
  it("lee la clave de la cabecera Bearer", () => {
    expect(parseBearer("Bearer abc")).toBe("abc");
    expect(parseBearer("bearer   abc ")).toBe("abc");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer a b")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
});

describe("permisos de las claves", () => {
  it("los presets son crecientes y cubren todas las herramientas sin repetir", () => {
    expect(new Set(ALL_TOOLS).size).toBe(ALL_TOOLS.length);
    expect(scopesForPreset("read")).toEqual([...READ_TOOLS]);
    expect(scopesForPreset("audit")).toEqual([...READ_TOOLS, ...AUDIT_TOOLS]);
    expect(scopesForPreset("configure")).toEqual([...ALL_TOOLS]);
    expect(PRESETS.configure.tools).toHaveLength(READ_TOOLS.length + AUDIT_TOOLS.length + CONFIG_TOOLS.length);
  });
  it("ninguna herramienta borra, cambia la fase, rota links o suspende", () => {
    for (const t of ALL_TOOLS) expect(t).not.toMatch(/delete|remove|archive|phase|token|suspend|rotate/);
  });
  it("reconoce el preset de una lista y marca lo demás como personalizado", () => {
    expect(presetOf(scopesForPreset("read"))).toBe("read");
    expect(presetOf([...scopesForPreset("audit")].reverse())).toBe("audit");
    expect(presetOf(scopesForPreset("configure"))).toBe("configure");
    expect(presetOf(["list_projects"])).toBe("custom");
    expect(presetOf([])).toBe("custom");
  });
  it("un preset desconocido es un error", () => {
    expect(() => scopesForPreset("admin")).toThrow();
  });
});
