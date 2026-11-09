import { requestJson, SpikeHttpError, type FetchLike, type Recorder } from "../http";
import type { Citation, ProbeAnswer, Provider } from "../probe";

/**
 * Proveedor Perplexity (Sonar, chat completions con búsqueda web integrada).
 *
 * Forma de la API (documentación oficial, consultada en noviembre de 2026):
 * - https://docs.perplexity.ai/api-reference/chat-completions-post y https://docs.perplexity.ai/docs/sonar/quickstart:
 *   `POST https://api.perplexity.ai/v1/sonar`, cabecera `Authorization: Bearer <clave>`,
 *   cuerpo `{ model: "sonar", messages: [{ role, content }] }`. La respuesta trae `choices[0].message.content`,
 *   `citations` (lista de URLs) y `search_results[]` con `title`, `url`, `date`, `last_updated`, `snippet`, `source`.
 * - AVISO: esas mismas páginas dicen "Sonar Chat Completions support ended on September 27, 2026": las peticiones
 *   síncronas siguen funcionando porque Perplexity las reformula como peticiones de la Agent API (`POST /v1/agent`,
 *   `effort` + `input`, respuesta en `output[]`), con despliegue gradual por modelo. Si este proveedor empieza a
 *   fallar o a devolver otra forma, hay que migrar a la Agent API (solo cambia este archivo).
 *
 * `location`: la documentación consultada no describe `web_search_options.user_location`, así que se acepta en las
 * opciones por simetría con los demás proveedores pero no se envía.
 */

export type ProviderLocation = { country?: string; city?: string; region?: string };

export type PerplexityOptions = {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  recorder?: Recorder;
  sleep?: (ms: number) => Promise<void>;
  /** Aceptada pero sin efecto: no está documentada para Sonar. */
  location?: ProviderLocation;
};

export const PERPLEXITY_DEFAULT_MODEL = "sonar";
const PERPLEXITY_URL = "https://api.perplexity.ai/v1/sonar";

type PerplexityResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  citations?: unknown;
  search_results?: Array<{ url?: string; title?: string }>;
};

/** Texto de la primera opción y fuentes únicas por URL: primero `search_results` (con título), luego `citations`. */
export function parsePerplexityResponse(res: PerplexityResponse): ProbeAnswer {
  const content = res.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";

  const byUrl = new Map<string, Citation>();
  for (const r of res.search_results ?? []) {
    if (!r.url || byUrl.has(r.url)) continue;
    byUrl.set(r.url, r.title ? { url: r.url, title: r.title } : { url: r.url });
  }
  if (Array.isArray(res.citations)) {
    for (const url of res.citations) {
      if (typeof url === "string" && url && !byUrl.has(url)) byUrl.set(url, { url });
    }
  }
  return { text, citations: [...byUrl.values()] };
}

export function createPerplexityProvider(opts: PerplexityOptions): Provider {
  const model = opts.model ?? PERPLEXITY_DEFAULT_MODEL;
  return {
    name: "perplexity",
    async ask(q) {
      try {
        const res = await requestJson<PerplexityResponse>({
          label: "perplexity:sonar",
          url: PERPLEXITY_URL,
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: { model, messages: [{ role: "user", content: q.prompt }] },
          timeoutMs: 90_000,
          fetchImpl: opts.fetchImpl,
          recorder: opts.recorder,
          sleep: opts.sleep,
        });
        return parsePerplexityResponse(res);
      } catch (e) {
        throw redact(e, opts.apiKey);
      }
    },
  };
}

/** Garantiza que la clave no viaje en el mensaje de un error (la API a veces repite parte de la petición). */
function redact(e: unknown, secret: string): unknown {
  if (!secret || !(e instanceof SpikeHttpError) || !e.message.includes(secret)) return e;
  return new SpikeHttpError(e.code, e.status, e.message.split(secret).join("[clave oculta]"));
}
