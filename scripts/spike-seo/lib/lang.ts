import { pagePath } from "./urls";

/** Un idioma del sitio y el prefijo de ruta que lo identifica (`es` → `/es`). */
export type Market = { lang: string; prefix: string };

/** Interpreta `SPIKE_LANGS`, por ejemplo `es=/es,en=/en`. El idioma sin prefijo va en `SPIKE_LANG_DEFAULT`. */
export function parseMarkets(spec: string): Market[] {
  return spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [lang, prefix] = part.split("=").map((s) => s.trim());
      const clean = (prefix ?? "").replace(/^\/+|\/+$/g, "");
      if (!lang || !clean) {
        throw new Error(`SPIKE_LANGS inválido: "${part}" (formato: es=/es,en=/en; el idioma sin prefijo va en SPIKE_LANG_DEFAULT).`);
      }
      return { lang, prefix: `/${clean}` };
    });
}

export type Classification = { lang: string | null; how: "prefix" | "default" | "none" };

/** Idioma de una página según el prefijo de su ruta. Sin prefijo conocido: el idioma por defecto, si hay uno. */
export function classifyPath(input: string, markets: Market[], defaultLang?: string): Classification {
  const path = pagePath(input);
  const ordered = [...markets].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const m of ordered) {
    if (path === m.prefix || path.startsWith(`${m.prefix}/`)) return { lang: m.lang, how: "prefix" };
  }
  return defaultLang ? { lang: defaultLang, how: "default" } : { lang: null, how: "none" };
}

export type PageMetric = { page: string; clicks: number; impressions: number };

export type LangSummary = {
  byLang: Record<string, { pages: number; clicks: number; impressions: number; viaDefault: number }>;
  unmatchedCount: number;
  unmatchedTop: PageMetric[];
};

/** Reparte las páginas por idioma y lista las que no encajan en ningún prefijo (las más visitadas primero). */
export function summarizeByLang(pages: PageMetric[], markets: Market[], defaultLang?: string): LangSummary {
  const byLang: LangSummary["byLang"] = {};
  const unmatched: PageMetric[] = [];
  for (const p of pages) {
    const c = classifyPath(p.page, markets, defaultLang);
    if (c.lang === null) {
      unmatched.push(p);
      continue;
    }
    const entry = (byLang[c.lang] ??= { pages: 0, clicks: 0, impressions: 0, viaDefault: 0 });
    entry.pages += 1;
    entry.clicks += p.clicks;
    entry.impressions += p.impressions;
    if (c.how === "default") entry.viaDefault += 1;
  }
  unmatched.sort((a, b) => b.clicks - a.clicks);
  return { byLang, unmatchedCount: unmatched.length, unmatchedTop: unmatched.slice(0, 20) };
}
