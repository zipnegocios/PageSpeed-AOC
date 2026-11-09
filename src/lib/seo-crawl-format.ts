import type { Change } from "@/server/domain/history";
import type { Evidence, IssueCode, Severity } from "@/server/domain/seo-crawl-rules";

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Error", warning: "Aviso", info: "Información" };
export const SEVERITY_PLURAL: Record<Severity, string> = { error: "Errores", warning: "Avisos", info: "Información" };

export const RUN_STATUS_LABEL = { queued: "En cola", running: "En curso", succeeded: "Completo", partial: "Parcial", failed: "Fallido" } as const;

/** Un valor de la evidencia como texto; «—» si falta. */
const str = (value: unknown): string => (value === undefined || value === null || value === "" ? "—" : String(value));
const list = (value: unknown): string => (Array.isArray(value) ? value.join(", ") : String(value ?? ""));
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const status = (value: unknown) => (num(value) === 0 ? "sin respuesta" : `estado ${num(value)}`);

/** Lo que se encontró en una página, en una frase para quien administra el sitio. Vacío si el hallazgo no necesita más. */
export function formatEvidence(code: IssueCode, e: Evidence): string {
  switch (code) {
    case "status_error":
      return `Respondió con ${status(e.status)}${e.inSitemap ? " · está en el sitemap" : ""}`;
    case "redirect_loop":
      return `${plural(num(e.hops), "salto", "saltos")} sin llegar a un destino`;
    case "redirect_chain":
      return `${plural(num(e.hops), "salto", "saltos")} hasta ${str(e.to)}`;
    case "broken_link": {
      const from = Array.isArray(e.from) ? e.from : [];
      const more = num(e.count) - from.length;
      return `Respondió con ${status(e.status)} · la enlazan ${plural(num(e.count), "página", "páginas")}: ${from.join(", ")}${more > 0 ? ` y ${more} más` : ""}`;
    }
    case "sitemap_url_redirected":
      return `Redirige a ${str(e.to)}`;
    case "canonical_target_bad":
      return `Su canónica ${str(e.canonical)} responde con ${status(e.status)} o redirige`;
    case "canonical_other_language":
      return `Su canónica ${str(e.canonical)} es de idioma «${str(e.found)}» y esta página es «${str(e.expected)}»`;
    case "title_missing":
      return e.empty ? "La etiqueta title está vacía" : "No tiene etiqueta title";
    case "title_length":
    case "description_long":
      return plural(num(e.length), "carácter", "caracteres");
    case "title_duplicate":
    case "description_duplicate":
      return `Igual en ${plural(num(e.count), "página", "páginas")}: ${list(e.also)}`;
    case "h1_multiple":
      return `Tiene ${num(e.count)} h1`;
    case "client_rendered":
      return `Solo ${plural(num(e.text), "carácter", "caracteres")} de texto sin JavaScript`;
    case "lang_mismatch":
      return `lang="${str(e.lang)}", pero la ruta indica «${str(e.expected)}»`;
    case "hreflang_invalid_code":
      return `Códigos inválidos: ${list(e.codes)}`;
    case "hreflang_target_bad":
    case "hreflang_not_reciprocal":
    case "hreflang_wrong_language":
      return `Alternativas: ${list(e.targets)}`;
    case "hreflang_absent":
    case "language_without_pages":
      return `Idiomas: ${list(e.languages)}`;
    case "jsonld_invalid":
      return plural(num(e.blocks), "bloque inválido", "bloques inválidos");
    case "jsonld_missing_props":
      return `Falta: ${list(e.missing).replaceAll(",", ";")}`;
    case "robots_unreadable":
      return `Respondió con ${status(e.status)}`;
    case "sitemap_unreadable":
      return `Direcciones probadas: ${list(e.urls)}`;
    default:
      return "";
  }
}

/** Cambio en el número de hallazgos entre dos rastreos: menos es mejor. Null si no hay con qué comparar. */
export function countDelta(current: number, previous: number | null): Change | null {
  if (previous === null) return null;
  const diff = current - previous;
  if (diff === 0) return { diff: 0, direction: "same", verdict: "same", text: "sin cambio" };
  return { diff, direction: diff > 0 ? "up" : "down", verdict: diff < 0 ? "better" : "worse", text: plural(Math.abs(diff), "hallazgo", "hallazgos") };
}
