import { requestJson, SpikeHttpError, type FetchLike, type Recorder } from "../http";
import type { Citation, ProbeAnswer, Provider } from "../probe";

/**
 * Proveedor Gemini con "Grounding with Google Search" (API `generateContent`).
 *
 * Forma de la API (documentación oficial, consultada en noviembre de 2026):
 * - https://aistudio.google.com/api-reference/generate-content (antes ai.google.dev/api/generate-content):
 *   `POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent`.
 *   La herramienta es `tools: [{ google_search: {} }]` (el esquema la nombra `googleSearch`; el JSON de la API
 *   acepta ambas grafías). `GroundingMetadata` cuelga de `candidates[i].groundingMetadata` y trae
 *   `groundingChunks[].web.{uri,title}`, `groundingSupports`, `webSearchQueries` y `searchEntryPoint`.
 * - https://aistudio.google.com/docs/google-search: la guía actual ya usa la Interactions API
 *   (`POST /v1beta/interactions`, `tools: [{ type: "google_search" }]`, citas como anotaciones `url_citation`)
 *   y ejemplifica con `gemini-3.8-flash`. `generateContent` sigue soportada pero figura como "legacy".
 *   Se usa `generateContent` porque es lo que pide el piloto; migrar a Interactions solo cambiaría este archivo.
 * - La autenticación va en la cabecera `x-goog-api-key`, nunca en la URL (así la clave no queda en registros de proxies).
 *
 * URIs de grounding: en `generateContent` las fuentes suelen ser redirecciones del tipo
 * `https://vertexaisearch.cloud.google.com/grounding-api-redirect/...` y `web.title` suele ser el dominio de la fuente
 * (p. ej. "aljazeera.com"). Aquí se conservan tal cual, sin llamadas de red extra, porque la documentación no lo exige.
 * Para resolverlas a la URL final basta, fuera de este proveedor, un `fetch(uri, { redirect: "manual" })` y leer la
 * cabecera `Location` (una petición por fuente, sin enviar la clave). Mientras tanto, `detectMention` compara el
 * dominio de cada cita: con redirecciones de vertexaisearch, `cited` saldrá siempre falso y habrá que fijarse en `title`.
 *
 * `location`: la API de grounding no documenta un parámetro de ubicación para `google_search`, así que se acepta
 * en las opciones por simetría con los demás proveedores pero no se envía.
 */

export type ProviderLocation = { country?: string; city?: string; region?: string };

export type GeminiOptions = {
  apiKey: string;
  /** Modelo por defecto: el que usan los ejemplos vigentes de la documentación de grounding. */
  model?: string;
  fetchImpl?: FetchLike;
  recorder?: Recorder;
  sleep?: (ms: number) => Promise<void>;
  /** Aceptada pero sin efecto: Gemini no documenta ubicación para `google_search`. */
  location?: ProviderLocation;
};

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = { text?: string; thought?: boolean };
type GeminiChunk = { web?: { uri?: string; title?: string } };
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    groundingMetadata?: { groundingChunks?: GeminiChunk[]; webSearchQueries?: string[] };
  }>;
};

/** Texto de la respuesta (sin las partes de razonamiento) y fuentes únicas por URL, en orden de aparición. */
export function parseGeminiResponse(res: GeminiResponse): ProbeAnswer {
  const candidate = res.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => typeof p.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("");

  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const title = chunk.web?.title;
    citations.push(title ? { url: uri, title } : { url: uri });
  }
  return { text, citations };
}

export function createGeminiProvider(opts: GeminiOptions): Provider {
  const model = opts.model ?? GEMINI_DEFAULT_MODEL;
  return {
    name: "gemini",
    async ask(q) {
      try {
        const res = await requestJson<GeminiResponse>({
          label: "gemini:generateContent",
          url: `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`,
          method: "POST",
          headers: { "x-goog-api-key": opts.apiKey },
          body: { contents: [{ role: "user", parts: [{ text: q.prompt }] }], tools: [{ google_search: {} }] },
          timeoutMs: 90_000,
          fetchImpl: opts.fetchImpl,
          recorder: opts.recorder,
          sleep: opts.sleep,
        });
        return parseGeminiResponse(res);
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
