import { requestJson, SpikeHttpError, type Ctx } from "./http";

const API = "https://api.cloudflare.com/client/v4";

/** Fragmentos de agente de usuario de los rastreadores de IA más habituales. */
export const AI_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "Amazonbot",
  "Applebot",
  "CCBot",
  "meta-externalagent",
  "DuckAssistBot",
];

/** Hosts de referido que indican una visita desde un asistente de IA. */
export const AI_REFERRER_HOSTS = ["chatgpt.com", "perplexity.ai", "claude.ai", "gemini.google.com", "copilot.microsoft.com"];

/** ¿A qué rastreador de IA corresponde este agente de usuario? null si a ninguno. */
export function matchAiBot(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  return AI_USER_AGENTS.find((bot) => ua.includes(bot.toLowerCase())) ?? null;
}

const ZONE_RE = /^[a-f0-9]{32}$/i;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function checked(zone: string, from: string, to: string): void {
  if (!ZONE_RE.test(zone)) throw new Error("SPIKE_CF_ZONE debe ser el ID de zona de Cloudflare (32 caracteres hexadecimales).");
  if (!TIME_RE.test(from) || !TIME_RE.test(to)) throw new Error("Las fechas de la consulta deben ser ISO UTC, por ejemplo 2026-11-01T00:00:00Z.");
}

export type CfWindow = { zone: string; from: string; to: string; limit?: number };

/** Solicitudes de rastreadores de IA por agente de usuario y host. La zona y las fechas se validan antes de insertarlas. */
export function buildAiCrawlerQuery(w: CfWindow): string {
  checked(w.zone, w.from, w.to);
  const any = AI_USER_AGENTS.map((ua) => `{ userAgent_like: "%${ua}%" }`).join(", ");
  return `query { viewer { zones(filter: { zoneTag: "${w.zone}" }) { httpRequestsAdaptiveGroups(filter: { datetime_geq: "${w.from}", datetime_leq: "${w.to}", requestSource: "eyeball", OR: [${any}] }, limit: ${w.limit ?? 5000}, orderBy: [count_DESC]) { count dimensions { userAgent clientRequestHTTPHost } sum { edgeResponseBytes } } } } }`;
}

/** Rutas más rastreadas por los bots de IA (solo respuestas 2xx y 3xx). */
export function buildAiPathsQuery(w: CfWindow): string {
  checked(w.zone, w.from, w.to);
  const any = AI_USER_AGENTS.map((ua) => `{ userAgent_like: "%${ua}%" }`).join(", ");
  return `query { viewer { zones(filter: { zoneTag: "${w.zone}" }) { httpRequestsAdaptiveGroups(filter: { datetime_geq: "${w.from}", datetime_leq: "${w.to}", requestSource: "eyeball", edgeResponseStatus_geq: 200, edgeResponseStatus_lt: 400, OR: [${any}] }, limit: ${w.limit ?? 5000}, orderBy: [count_DESC]) { count dimensions { clientRequestPath userAgent } } } } }`;
}

/** Visitas que llegan desde asistentes de IA según el referido. Cloudflare solo lo ofrece en planes de pago. */
export function buildAiReferralQuery(w: CfWindow): string {
  checked(w.zone, w.from, w.to);
  const any = AI_REFERRER_HOSTS.map((h) => `{ clientRefererHost_like: "%${h}%" }`).join(", ");
  return `query { viewer { zones(filter: { zoneTag: "${w.zone}" }) { httpRequestsAdaptiveGroups(filter: { datetime_geq: "${w.from}", datetime_leq: "${w.to}", requestSource: "eyeball", OR: [${any}] }, limit: ${w.limit ?? 5000}, orderBy: [count_DESC]) { count dimensions { clientRefererHost } } } } }`;
}

export type CfGroup = { count: number; dimensions: Record<string, string>; sum?: { edgeResponseBytes?: number } };

/** Ejecuta una consulta GraphQL. Cloudflare responde 200 con `errors` cuando falla: se convierte en error. */
export async function cfGraphql(ctx: Ctx & { token: string }, query: string, label: string): Promise<CfGroup[]> {
  const res = await requestJson<{ data?: { viewer?: { zones?: Array<{ httpRequestsAdaptiveGroups?: CfGroup[] }> } }; errors?: Array<{ message?: string }> | null }>({
    ...ctx,
    label,
    url: `${API}/graphql`,
    headers: { Authorization: `Bearer ${ctx.token}` },
    body: { query },
  });
  if (res.errors?.length) throw new SpikeHttpError("BAD_REQUEST", 200, `${label}: ${res.errors.map((e) => e.message ?? "error").join("; ").slice(0, 300)}`);
  const zone = res.data?.viewer?.zones?.[0];
  if (!zone) throw new SpikeHttpError("FORBIDDEN", 200, `${label}: el token no ve esa zona.`);
  return zone.httpRequestsAdaptiveGroups ?? [];
}

/** Comprueba que el token es válido y está activo. */
export async function verifyToken(ctx: Ctx & { token: string }): Promise<{ status: string }> {
  const res = await requestJson<{ result?: { status?: string } }>({ ...ctx, label: "cf-verify", url: `${API}/user/tokens/verify`, headers: { Authorization: `Bearer ${ctx.token}` } });
  return { status: res.result?.status ?? "desconocido" };
}
