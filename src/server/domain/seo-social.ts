/**
 * Redes sociales de las que llegan visitas (GA4 las agrupa en un solo canal, «Organic Social»). GA4 entrega la **fuente** de
 * cada sesión como un texto libre (`facebook`, `m.facebook.com`, `l.instagram.com`, `t.co`, `lnkd.in`…): aquí se normaliza a la
 * red. Lógica pura, sin red ni base de datos.
 */
export type SocialNetwork = { key: string; label: string; /** ¿Esta fuente (en minúsculas, sin `www.`) es de esta red? */ test: (source: string) => boolean };

const has = (...words: string[]) => (s: string) => words.some((w) => s.includes(w));
const exact = (...hosts: string[]) => (s: string) => hosts.some((h) => s === h || s.endsWith(`.${h}`));

/** El orden importa: la primera que coincide gana. */
export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  { key: "facebook", label: "Facebook", test: (s) => has("facebook")(s) || exact("fb.com", "fb.me", "fb")(s) },
  { key: "instagram", label: "Instagram", test: (s) => has("instagram")(s) || s === "ig" },
  { key: "linkedin", label: "LinkedIn", test: (s) => has("linkedin")(s) || exact("lnkd.in")(s) },
  { key: "x", label: "X (Twitter)", test: (s) => has("twitter")(s) || exact("t.co", "x.com")(s) || s === "x" },
  { key: "tiktok", label: "TikTok", test: has("tiktok") },
  { key: "youtube", label: "YouTube", test: (s) => has("youtube")(s) || exact("youtu.be")(s) },
  { key: "pinterest", label: "Pinterest", test: (s) => has("pinterest")(s) || exact("pin.it")(s) },
  { key: "reddit", label: "Reddit", test: has("reddit") },
  { key: "whatsapp", label: "WhatsApp", test: (s) => has("whatsapp")(s) || exact("wa.me")(s) },
  { key: "telegram", label: "Telegram", test: (s) => has("telegram")(s) || exact("t.me")(s) },
  { key: "threads", label: "Threads", test: exact("threads.net", "threads.com") },
  { key: "snapchat", label: "Snapchat", test: has("snapchat") },
  { key: "tumblr", label: "Tumblr", test: has("tumblr") },
  { key: "discord", label: "Discord", test: has("discord") },
  { key: "twitch", label: "Twitch", test: has("twitch") },
  { key: "quora", label: "Quora", test: has("quora") },
  { key: "vk", label: "VK", test: exact("vk.com", "vk.ru") },
];

/** Todo lo que GA4 marca como social pero no está en la lista. */
export const OTHER_SOCIAL = { key: "other", label: "Otras redes" } as const;

/** Grupos de canal de GA4 que cuentan como redes sociales (el vídeo orgánico es, casi siempre, YouTube). */
export const SOCIAL_CHANNEL_GROUPS = ["Organic Social", "Paid Social", "Organic Video"] as const;

/** Fragmentos que acotan la consulta a GA4 por fuente (WhatsApp o Telegram llegan a veces como «referido»). Se afina en local. */
export const SOCIAL_SOURCE_REGEX = "facebook|instagram|linkedin|lnkd\\.in|twitter|tiktok|youtube|youtu\\.be|pinterest|reddit|whatsapp|telegram|snapchat|tumblr|discord|twitch|quora|threads\\.net";

const clean = (source: string) => source.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** La red de una fuente de sesión, o null si no es de ninguna red conocida. */
export function classifySocial(source: string): { key: string; label: string } | null {
  const s = clean(source);
  if (!s || s === "(direct)" || s === "(not set)") return null;
  const found = SOCIAL_NETWORKS.find((n) => n.test(s));
  return found ? { key: found.key, label: found.label } : null;
}

/**
 * La red de una fila de GA4: la de su fuente y, si no se reconoce pero GA4 la agrupó como social, «Otras redes».
 * null = no es social (por ejemplo, una fuente que solo coincidió con el filtro amplio).
 */
export function networkOf(source: string, channelGroup: string): string | null {
  const known = classifySocial(source);
  if (known) return known.key;
  return (SOCIAL_CHANNEL_GROUPS as readonly string[]).includes(channelGroup) ? OTHER_SOCIAL.key : null;
}

export function socialLabel(key: string): string {
  return SOCIAL_NETWORKS.find((n) => n.key === key)?.label ?? OTHER_SOCIAL.label;
}
