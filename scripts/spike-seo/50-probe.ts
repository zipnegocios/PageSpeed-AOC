// Fase 0 · Sondeo de IA: lanza unas pocas preguntas varias veces y registra si se menciona o se cita al cliente.
// Proveedores: mock (sin red), anthropic, openai, gemini y perplexity (los que tengan clave en .env.spike);
// `--provider all` usa todos los configurados. Cada llamada de un proveedor real cuesta dinero: empieza con pocas
// preguntas y pocas repeticiones.
// Uso: pnpm exec tsx scripts/spike-seo/50-probe.ts --provider mock [--prompts scripts/spike-seo/prompts.json] [--repeats 3]
import { readFileSync } from "node:fs";
import { loadConfig } from "./lib/config";
import { Recorder } from "./lib/http";
import { writeJson } from "./lib/out";
import { detectMention, summarizeRuns, type ProbeQuestion, type ProbeRun, type ProbeTarget } from "./lib/probe";
import { availableProviders } from "./lib/providers";
import { arg, log, run, table } from "./lib/run";

type PromptFile = ProbeTarget & { prompts: ProbeQuestion[] };

await run(async () => {
  const cfg = loadConfig();
  const recorder = new Recorder();
  const available = availableProviders(process.env, { recorder });
  const wanted = arg("provider") ?? "mock";
  const names = wanted === "all" ? Object.keys(available).filter((n) => n !== "mock") : wanted.split(",").map((n) => n.trim());
  if (names.length === 0) throw new Error("No hay proveedores con clave. Define SPIKE_ANTHROPIC_API_KEY, SPIKE_OPENAI_API_KEY, SPIKE_GEMINI_API_KEY o SPIKE_PERPLEXITY_API_KEY, o usa --provider mock.");
  const chosen = names.map((name) => {
    const provider = available[name];
    if (!provider) throw new Error(`Proveedor "${name}" no disponible. Configurados: ${Object.keys(available).join(", ")}.`);
    return provider;
  });

  const file = arg("prompts") ?? "scripts/spike-seo/prompts.json";
  let spec: PromptFile;
  try {
    spec = JSON.parse(readFileSync(file, "utf8")) as PromptFile;
  } catch {
    throw new Error(`No se pudo leer ${file}. Copia scripts/spike-seo/prompts.example.json a ese nombre y edítalo.`);
  }
  if (!spec.domain || !Array.isArray(spec.brands) || !Array.isArray(spec.prompts)) throw new Error(`${file} debe tener "brands", "domain" y "prompts".`);
  const repeats = Number(arg("repeats") ?? 3);
  log(`Proveedores: ${chosen.map((p) => p.name).join(", ")} · preguntas: ${spec.prompts.length} · repeticiones: ${repeats} · llamadas: ${chosen.length * spec.prompts.length * repeats}\n`);

  const runs: ProbeRun[] = [];
  const failures: Array<{ provider: string; prompt: string; repeat: number; error: string }> = [];
  for (const provider of chosen) {
    for (const q of spec.prompts) {
      for (let repeat = 1; repeat <= repeats; repeat++) {
        try {
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
        } catch (err) {
          // Una pregunta que falla no tira el resto del sondeo: se anota y se sigue.
          failures.push({ provider: provider.name, prompt: q.prompt, repeat, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  const summary = summarizeRuns(runs);
  writeJson(cfg, "probe-runs", runs);
  writeJson(cfg, "probe-summary", summary);
  writeJson(cfg, "probe-failures", failures);
  writeJson(cfg, "probe-calls", recorder.summary());

  table(summary.map((s) => ({ proveedor: s.provider, idioma: s.lang, pregunta: s.prompt.slice(0, 50), "% menciona": Math.round(s.mentionRate * 100), "% cita": Math.round(s.citedRate * 100) })));
  if (failures.length) {
    log(`\nFallos: ${failures.length}`);
    table(failures.slice(0, 10).map((f) => ({ proveedor: f.provider, repetición: f.repeat, error: f.error.slice(0, 90) })));
    process.exitCode = 1;
  }
  log(`\nSalida en ${cfg.outDir}`);
});
