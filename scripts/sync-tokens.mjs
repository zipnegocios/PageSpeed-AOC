// Genera src/lib/ui/tokens/tokens.css y tailwind-theme.css a partir de design/tokens.json.
// design/tokens.json es un espejo del Design System "PageSpeed": NO editar valores a mano.
// Flujo: cambiar en el Design System -> copiar tokens.json a design/ -> `pnpm tokens:sync`.
import { readFileSync, writeFileSync } from "node:fs";

const src = JSON.parse(readFileSync(new URL("../design/tokens.json", import.meta.url), "utf8"));
const outDir = new URL("../src/lib/ui/tokens/", import.meta.url);
// Tema por defecto (siempre activo). Los demás solo se activan con data-theme="<id>" (p. ej. light para el PDF).
const ids = src.color.themes.map((t) => t.id);
const first = src.color.defaultTheme ?? ids[0];
const others = ids.filter((id) => id !== first);
const ref = (v) => v.replace(/^\{(.+)\}$/, "var(--$1)");
const valueFor = (t, theme) =>
  typeof t.value === "string" ? ref(t.value) : ref(t.value[theme] ?? t.value[first]);
const decls = (theme) =>
  src.color.tokens
    .filter((t) => theme === first || (typeof t.value !== "string" && t.value[theme] !== undefined))
    .map((t) => `  --${t.name}: ${valueFor(t, theme)};`)
    .join("\n");
const lengths = (family) =>
  (src[family]?.tokens ?? []).map((t) => `  --${t.name}: ${t.value};`).join("\n");
const fonts = Object.entries(src.type.families)
  .map(([k, v]) => `  --font-${k}: ${v};`)
  .join("\n");

let css = `/* ${src.name} — generated from design/tokens.json (Design System mirror). Do not edit. */\n`;
css += `:root {\n${decls(first)}\n${lengths("spacing")}\n${lengths("radius")}\n${lengths("effects")}\n${fonts}\n  color-scheme: ${first};\n}\n`;
for (const theme of others) {
  const body = decls(theme);
  css += `:root[data-theme="${theme}"] {\n${body}\n  color-scheme: ${theme};\n}\n`;
}
writeFileSync(new URL("tokens.css", outDir), css);

const theme = [
  ...src.color.tokens.map((t) => `  --color-${t.name}: var(--${t.name});`),
  ...src.spacing.tokens.map((t) => `  --spacing-${t.name}: var(--${t.name});`),
  ...src.radius.tokens.map((t) => `  --radius-${t.name.replace(/^radius-/, "")}: var(--${t.name});`),
  ...Object.keys(src.type.families).map((k) => `  --font-${k}: var(--font-${k});`),
].join("\n");
writeFileSync(
  new URL("tailwind-theme.css", outDir),
  `/* generated from design/tokens.json — do not edit */\n@theme inline {\n${theme}\n}\n`,
);
console.log("tokens synced");
