import { hostOf } from "./urls";

/** Sondeo de IA: interfaz de proveedor, detección de menciones y un proveedor simulado para probar el flujo. */

export type ProbeQuestion = { lang: string; prompt: string };
export type Citation = { url: string; title?: string };
export type ProbeAnswer = { text: string; citations: Citation[] };

export type Provider = {
  name: string;
  ask(q: ProbeQuestion): Promise<ProbeAnswer>;
};

export type ProbeTarget = { brands: string[]; domain: string };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export type Mention = {
  /** La respuesta nombra la marca (sin distinguir mayúsculas ni acentos). */
  mentioned: boolean;
  /** Alguna fuente citada es del dominio del cliente. */
  cited: boolean;
  citedUrls: string[];
  /** Otros dominios citados: candidatos a competidores o fuentes de referencia. */
  otherDomains: string[];
};

export function detectMention(answer: ProbeAnswer, target: ProbeTarget): Mention {
  const text = fold(answer.text);
  const domain = target.domain.toLowerCase().replace(/^www\./, "");
  const citedUrls: string[] = [];
  const others = new Set<string>();
  for (const c of answer.citations) {
    const host = hostOf(c.url)?.replace(/^www\./, "");
    if (!host) continue;
    if (host === domain || host.endsWith(`.${domain}`)) citedUrls.push(c.url);
    else others.add(host);
  }
  return {
    mentioned: target.brands.some((b) => text.includes(fold(b))) || text.includes(domain),
    cited: citedUrls.length > 0,
    citedUrls,
    otherDomains: [...others].sort(),
  };
}

/** Proveedor simulado: no llama a ninguna API. Sirve para comprobar el flujo, los archivos y el informe. */
export const mockProvider: Provider = {
  name: "mock",
  async ask(q) {
    return { text: `Respuesta simulada (${q.lang}) para: ${q.prompt}`, citations: [] };
  },
};

/** Proveedores disponibles. Los reales se añaden cuando se decida con cuáles sondear (ver el plan). */
export const providers: Record<string, Provider> = { mock: mockProvider };

export type ProbeRun = {
  provider: string;
  lang: string;
  prompt: string;
  repeat: number;
  at: string;
  mentioned: boolean;
  cited: boolean;
  citedUrls: string[];
  otherDomains: string[];
  /** Extracto de la respuesta, para revisarla a mano. */
  excerpt: string;
};

export type PromptSummary = { provider: string; lang: string; prompt: string; runs: number; mentionRate: number; citedRate: number };

/** Tasa de mención y de cita por pregunta, sobre todas sus repeticiones. */
export function summarizeRuns(runs: ProbeRun[]): PromptSummary[] {
  const groups = new Map<string, ProbeRun[]>();
  for (const r of runs) {
    const key = `${r.provider}|${r.lang}|${r.prompt}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((g) => ({
    provider: g[0]?.provider ?? "",
    lang: g[0]?.lang ?? "",
    prompt: g[0]?.prompt ?? "",
    runs: g.length,
    mentionRate: g.filter((r) => r.mentioned).length / g.length,
    citedRate: g.filter((r) => r.cited).length / g.length,
  }));
}
