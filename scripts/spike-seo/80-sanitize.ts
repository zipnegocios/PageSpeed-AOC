// Fase 0 · Fixtures: copia saneada de la salida del piloto para usarla en pruebas de la fase 1 sin exponer datos del cliente.
// Sustituye host, rutas, consultas y textos por seudónimos estables, conserva los prefijos de idioma de SPIKE_LANGS y
// perturba las cifras sin cambiar su orden de magnitud. Antes de escribir comprueba que no quede nada del original.
// Sal opcional: SPIKE_FIXTURE_SALT. Uso: pnpm exec tsx scripts/spike-seo/80-sanitize.ts
// Aun saneados, revisa los fixtures a ojo antes de copiarlos al repo: nunca se suben sin revisar.
import { join } from "node:path";
import { loadConfig } from "./lib/config";
import { readJson, writeJson } from "./lib/out";
import { FIXTURE_NAMES, knownFromConfig, sanitizeAll, type FixtureName } from "./lib/sanitize";
import { log, run, table } from "./lib/run";

await run(async () => {
  const cfg = loadConfig();
  const inputs: Partial<Record<FixtureName, unknown>> = {};
  const missing: string[] = [];
  for (const name of FIXTURE_NAMES) {
    const data = readJson<unknown>(cfg, name);
    if (data === null) missing.push(name);
    else inputs[name] = data;
  }
  if (Object.keys(inputs).length === 0) throw new Error(`No hay ningún archivo que sanear en ${cfg.outDir}: corre antes los scripts 10 a 50.`);

  // Si algún archivo deja una fuga, lanza aquí y no se escribe ninguno.
  const outputs = sanitizeAll(inputs, {
    markets: cfg.markets,
    salt: process.env.SPIKE_FIXTURE_SALT || undefined,
    ga4Property: cfg.ga4Property,
    cfZone: cfg.cfZone,
    known: knownFromConfig(cfg),
  });

  const dir = join(cfg.outDir, "fixtures");
  const rows: Array<{ archivo: string; filas: number | string }> = [];
  for (const name of FIXTURE_NAMES) {
    const data = outputs[name];
    if (data === undefined) continue;
    writeJson({ outDir: dir }, name, data);
    rows.push({ archivo: `${name}.json`, filas: Array.isArray(data) ? data.length : "objeto" });
  }

  table(rows);
  if (missing.length > 0) log(`\nOmitidos por no existir en la salida: ${missing.join(", ")}`);
  log(`\nFixtures en ${dir}`);
  log("Revisa a ojo antes de copiarlos al repo.");
});
