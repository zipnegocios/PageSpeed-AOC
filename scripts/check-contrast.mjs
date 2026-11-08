// Comprueba el contraste WCAG de los pares de color del tema oscuro (el tema de la app) leyendo design/tokens.json.
// Texto >= 4.5:1; bordes, anillo de foco y marcas de gráficos >= 3:1, sobre las tres superficies sólidas del tema.
// Uso: node scripts/check-contrast.mjs   (sale con código 1 si algo falla)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tokensPath = new URL("../design/tokens.json", import.meta.url);

export function parseColor(input) {
  const hex = /^#([0-9a-f]{6})$/i.exec(input);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(input);
  if (!m) throw new Error(`Color no reconocido: ${input}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

/** `top` (con alfa) sobre `base` opaco. */
export function over(top, base) {
  const a = top.a;
  return { r: top.r * a + base.r * (1 - a), g: top.g * a + base.g * (1 - a), b: top.b * a + base.b * (1 - a), a: 1 };
}

const lin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function checkContrast(tokens = JSON.parse(readFileSync(tokensPath, "utf8")), theme = tokens.color.defaultTheme ?? "dark") {
  const byName = new Map(tokens.color.tokens.map((t) => [t.name, t]));
  const raw = (name) => {
    let v = byName.get(name)?.value;
    if (v === undefined) throw new Error(`Falta el token ${name}`);
    v = typeof v === "string" ? v : (v[theme] ?? v[Object.keys(v)[0]]);
    const ref = /^\{(.+)\}$/.exec(v);
    return ref ? raw(ref[1]) : v;
  };
  const solid = (name) => parseColor(raw(name));
  const surfaces = { "surface-100": solid("surface-100"), "surface-200": solid("surface-200"), "surface-300": solid("surface-300") };

  const rows = [];
  const add = (fg, bgName, bg, min, kind) => rows.push({ fg, bg: bgName, ratio: contrast(solid(fg), bg), min, kind });
  // Texto (4.5:1) sobre cada superficie: el texto principal y el secundario, el enlace y los colores de estado.
  for (const [bgName, bg] of Object.entries(surfaces)) {
    for (const fg of ["ink", "ink-muted", "link", "primary", "ok", "warning", "danger"]) add(fg, bgName, bg, 4.5, "texto");
  }
  // No texto (3:1): bordes de controles, anillo de foco y marcas de gráficos.
  for (const [bgName, bg] of Object.entries(surfaces)) {
    for (const fg of ["border-strong", "focus-ring", "chart-1", "chart-2", "chart-3"]) add(fg, bgName, bg, 3, "no texto");
  }
  // Texto sobre rellenos de color.
  for (const [fg, bg] of [["on-primary", "primary"], ["on-primary", "primary-hover"], ["on-primary-subtle", "primary-subtle"], ["on-danger-subtle", "danger-subtle"], ["on-ok-subtle", "ok-subtle"]]) {
    add(fg, bg, solid(bg), 4.5, "texto");
  }
  return rows.map((r) => ({ ...r, ok: r.ratio >= r.min }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = checkContrast();
  for (const r of rows) console.log(`${r.ok ? "OK   " : "FALLA"} ${r.fg.padEnd(18)} sobre ${r.bg.padEnd(12)} ${r.ratio.toFixed(2)}:1 (mín. ${r.min}) ${r.kind}`);
  const bad = rows.filter((r) => !r.ok);
  console.log(bad.length ? `\n${bad.length} pares por debajo del mínimo` : `\nTodos los pares cumplen (${rows.length})`);
  process.exit(bad.length ? 1 : 0);
}
