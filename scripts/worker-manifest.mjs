// Genera dist/worker/package.json con SOLO las dependencias que el worker compilado importa,
// fijadas a las versiones exactas instaladas en este repositorio. La imagen del worker instala
// eso y nada más (sin Next, React ni Tailwind). Uso: node scripts/worker-manifest.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";

const dir = new URL("../dist/worker/", import.meta.url);
const entry = new URL("index.js", dir);
if (!existsSync(entry)) {
  console.error("Falta dist/worker/index.js: ejecuta antes `pnpm worker:build`.");
  process.exit(1);
}

const code = readFileSync(entry, "utf8");
const specifiers = new Set();
for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s*["']([^"']+)["']/g]) {
  for (const m of code.matchAll(re)) specifiers.add(m[1]);
}

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

const packages = [...specifiers]
  .filter((s) => !s.startsWith(".") && !s.startsWith("/") && !builtins.has(s) && !s.startsWith("node:"))
  .map(packageOf);
const unique = [...new Set(packages)].sort();

const require = createRequire(new URL("../package.json", import.meta.url));
const dependencies = {};
for (const name of unique) {
  // Se lee el package.json sin pasar por `exports`, que puede ocultarlo.
  let manifestPath;
  try {
    manifestPath = require.resolve(`${name}/package.json`);
  } catch {
    const main = require.resolve(name);
    manifestPath = main.slice(0, main.lastIndexOf(`node_modules/${name}`) + `node_modules/${name}`.length) + "/package.json";
  }
  dependencies[name] = JSON.parse(readFileSync(manifestPath, "utf8")).version;
}

const manifest = {
  name: "aoc-pagespeed-worker",
  version: "0.0.0",
  private: true,
  type: "module",
  engines: { node: ">=22.19" },
  dependencies,
};
writeFileSync(new URL("package.json", dir), JSON.stringify(manifest, null, 2) + "\n");
console.log(`worker-manifest: ${unique.length} dependencias -> ${unique.join(", ")}`);
