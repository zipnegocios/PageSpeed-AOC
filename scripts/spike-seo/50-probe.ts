// Fase 0 · Sondeo de IA: lanza unas pocas preguntas varias veces y registra si se menciona o se cita al cliente.
// Sin proveedor real todavía: usa `--provider mock` para probar el flujo. Los proveedores reales se añaden en
// lib/probe.ts cuando se decida con cuáles sondear (ver el plan de la fase 0).
// Uso: pnpm exec tsx scripts/spike-seo/50-probe.ts --provider mock [--prompts scripts/spike-seo/prompts.json] [--repeats 3]
import { readFileSync } from "node:fs";
import { loadConfig } from "./lib/config";
import { writeJson } from "./lib/out";
import { detectMention, providers, summarizeRuns, type ProbeQuestion, type ProbeRun, type ProbeTarget } from "./lib/probe";
import { arg, log, run, table } from "./lib/run";

type PromptFile = ProbeTarget & { prompts: ProbeQuestion[] };

await run(async () => {
  const cfg = loadConfig();
  const name = arg("provider") ?? "mock";
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Proveedor no implementado todavía: "${name}". Disponibles: ${Object.keys(providers).join(", ")}. Falta decidir con cuáles se sondea.`);
  }
  const file = arg("prompts") ?? "scripts/spike-seo/prompts.json";
  let spec: PromptFile;
  try {
    spec = JSON.parse(readFileSync(file, "utf8")) as PromptFile;
  } catch {
    throw new Error(`No se pudo leer ${file}. Copia scripts/spike-seo/prompts.example.json a ese nombre y edítalo.`);
  }
  if (!spec.domain || !Array.isArray(spec.brands) || !Array.isArray(spec.prompts)) throw new Error(`${file} debe tener "brands", "domain" y "prompts".`);
  const repeats = Number(arg("repeats") ?? 3);

  const runs: ProbeRun[] = [];
  for (const q of spec.prompts) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const answer = await provider.ask(q);
      const m = detectMention(answer, spec);
      runs.push({
        provider: provider.name,
        lang: q.lang,
        prompt: q.prompt,
        repeat,
        at: new Date().toISOString(),
        mentioned: m.mentioned,
        cited: m.cited,
        citedUrls: m.citedUrls,
        otherDomains: m.otherDomains,
        excerpt: answer.text.slice(0, 500),
      });
    }
  }

  const summary = summarizeRuns(runs);
  writeJson(cfg, "probe-runs", runs);
  writeJson(cfg, "probe-summary", summary);
  log(`Proveedor: ${provider.name} · preguntas: ${spec.prompts.length} · repeticiones: ${repeats}\n`);
  table(summary.map((s) => ({ idioma: s.lang, pregunta: s.prompt.slice(0, 60), "% menciona": Math.round(s.mentionRate * 100), "% cita": Math.round(s.citedRate * 100) })));
  log(`\nSalida en ${cfg.outDir}`);
});
