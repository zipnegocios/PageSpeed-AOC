import { classifySocial, OTHER_SOCIAL, SOCIAL_CHANNEL_GROUPS } from "./seo-social";

/**
 * De dónde llegan las visitas, **repartidas por completo**: cada sesión cae en un solo grupo (buscador, directo, red social,
 * otro sitio, correo, anuncio o asistente de IA), de modo que los porcentajes suman el 100 % en el portal, el PDF y los correos.
 * Lógica pura: clasifica la fuente de GA4 (`sessionSource`) con su grupo de canal por defecto (`sessionDefaultChannelGroup`).
 */
export type SourceGroup = "search" | "direct" | "social" | "referral" | "email" | "paid" | "ai" | "other";

/** El orden en que se muestran los grupos. */
export const SOURCE_GROUPS: readonly SourceGroup[] = ["search", "social", "direct", "referral", "ai", "email", "paid", "other"];

export const SOURCE_GROUP_LABEL: Record<SourceGroup, string> = {
  search: "Buscadores",
  social: "Redes sociales",
  direct: "Directo o sin identificar",
  referral: "Otros sitios",
  ai: "Asistentes de IA",
  email: "Correo",
  paid: "Anuncios",
  other: "Otros",
};

/** Asistentes de IA. Los enlaces de ChatGPT con `utm_source` llegan como `chatgpt.com`. */
export const AI_SOURCE_REGEX = "chatgpt\\.com|chat\\.openai\\.com|perplexity|claude\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com";
export const isAiSource = (source: string): boolean => new RegExp(AI_SOURCE_REGEX, "i").test(source);

const ENGINES: ReadonlyArray<{ key: string; label: string; test: (s: string) => boolean }> = [
  { key: "google", label: "Google", test: (s) => /(^|\.)google\./.test(s) || s === "google" },
  { key: "bing", label: "Bing", test: (s) => s.includes("bing") },
  { key: "duckduckgo", label: "DuckDuckGo", test: (s) => s.includes("duckduckgo") },
  { key: "yahoo", label: "Yahoo", test: (s) => s.includes("yahoo") },
  { key: "ecosia", label: "Ecosia", test: (s) => s.includes("ecosia") },
  { key: "brave", label: "Brave", test: (s) => s.includes("brave") },
  { key: "yandex", label: "Yandex", test: (s) => s.includes("yandex") },
  { key: "baidu", label: "Baidu", test: (s) => s.includes("baidu") },
];

const clean = (source: string) => source.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

export type SourceKey = { group: SourceGroup; key: string };

/** La clave de «Directo o sin identificar»: un solo renglón. */
export const DIRECT_KEY = "direct";

/**
 * El grupo y la clave de una fila de GA4. Precedencia: asistente de IA, red social (por su fuente), directo, y luego el grupo de
 * canal de GA4 (buscador, correo, anuncio, otro sitio, red social no reconocida).
 */
export function classifySource(source: string, channelGroup: string): SourceKey {
  const s = clean(source);
  if (s && isAiSource(s)) return { group: "ai", key: s.replace(/\.(com|ai)$/, "") };
  const social = classifySocial(s);
  if (social) return { group: "social", key: social.key };
  if (!s || s === "(direct)" || s === "(not set)" || channelGroup === "Direct" || channelGroup === "Unassigned") return { group: "direct", key: DIRECT_KEY };
  if ((SOCIAL_CHANNEL_GROUPS as readonly string[]).includes(channelGroup)) return { group: "social", key: OTHER_SOCIAL.key };
  if (channelGroup === "Organic Search") {
    const engine = ENGINES.find((e) => e.test(s));
    return { group: "search", key: engine?.key ?? "other" };
  }
  if (channelGroup === "Email") return { group: "email", key: "email" };
  if (channelGroup.startsWith("Paid") || channelGroup === "Display" || channelGroup === "Cross-network" || channelGroup === "Affiliates") return { group: "paid", key: "paid" };
  if (channelGroup === "Referral") return { group: "referral", key: s };
  return { group: "other", key: s || "other" };
}

/** El nombre que ve el cliente de una fuente concreta dentro de su grupo. */
export function sourceLabel(group: SourceGroup, key: string): string {
  if (group === "social") return classifySocial(key)?.label ?? (key === OTHER_SOCIAL.key ? OTHER_SOCIAL.label : key);
  if (group === "search") return ENGINES.find((e) => e.key === key)?.label ?? "Otros buscadores";
  if (group === "direct") return SOURCE_GROUP_LABEL.direct;
  if (group === "email") return "Correo";
  if (group === "paid") return "Anuncios";
  if (group === "ai") return AI_LABEL[key] ?? key;
  return key;
}

const AI_LABEL: Record<string, string> = { chatgpt: "ChatGPT", "chat.openai": "ChatGPT", perplexity: "Perplexity", claude: "Claude", "gemini.google": "Gemini", "copilot.microsoft": "Copilot" };
