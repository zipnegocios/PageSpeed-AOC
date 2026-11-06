import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- módulo .mjs sin tipos (también se ejecuta por consola en CI)
import { checkContrast, contrast, over, parseColor } from "../../scripts/check-contrast.mjs";

type Row = { fg: string; bg: string; ratio: number; min: number; ok: boolean };

describe("contraste del tema espacial", () => {
  it("todos los pares de texto, bordes, foco y series cumplen su mínimo, también sobre el vidrio", () => {
    const rows: Row[] = checkContrast();
    expect(rows.length).toBeGreaterThan(40);
    const bad = rows.filter((r) => !r.ok).map((r) => `${r.fg} sobre ${r.bg}: ${r.ratio.toFixed(2)}:1 (mín. ${r.min})`);
    expect(bad).toEqual([]);
  });

  it("calcula bien la razón de contraste y la composición de transparencias", () => {
    expect(contrast(parseColor("#ffffff"), parseColor("#000000"))).toBeCloseTo(21, 5);
    expect(contrast(parseColor("#777777"), parseColor("#ffffff"))).toBeCloseTo(4.48, 1);
    expect(over(parseColor("rgba(255,255,255,0.5)"), parseColor("#000000"))).toMatchObject({ r: 127.5, g: 127.5, b: 127.5 });
  });
});

describe("tokens generados", () => {
  const css = readFileSync("src/lib/ui/tokens/tokens.css", "utf8");
  it("el tema oscuro es el de :root y no depende de la preferencia del sistema", () => {
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).toMatch(/:root \{[\s\S]*--space: #04070f;[\s\S]*color-scheme: dark;/);
  });
  it("el tema claro solo existe bajo data-theme (PDF y correos) y los efectos están definidos", () => {
    expect(css).toMatch(/:root\[data-theme="light"\]/);
    for (const name of ["--glass", "--glass-border", "--glow-primary", "--blur-glass", "--chart-1", "--chart-2", "--chart-3", "--ok-subtle"]) {
      expect(css).toContain(`${name}:`);
    }
  });
});
