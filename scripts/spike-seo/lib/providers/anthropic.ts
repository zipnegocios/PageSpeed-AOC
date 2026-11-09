import { requestJson, SpikeHttpError, type Ctx } from "../http";
import type { Citation, ProbeAnswer, ProbeQuestion, Provider } from "../probe";

/**
 * Proveedor de sondeo con la Messages API de Anthropic y su herramienta de búsqueda web (del lado del servidor).
 * Documentación: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 */

export type ApproximateLocation = { country?: string; city?: string; region?: string };

export type AnthropicProviderOptions = Ctx & {
  apiKey: string;
  /** Por defecto `claude-sonnet-5-5`. */
  model?: string;
  location?: ApproximateLocation;
  /** Tipo de la herramienta (por defecto `web_search_20260209`; la versión básica es `web_search_20250305`). */
  toolType?: string;
  /** Búsquedas máximas por pregunta (por defecto 5): acota el coste. */
  maxSearches?: number;
};

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_TOOL = "web_search_20260209";
/** La búsqueda web tarda: tiempo máximo largo por petición. */
const TIMEOUT_MS = 90_000;
/** Respuestas con `pause_turn`: cuántas veces se reanuda antes de rendirse. */
const MAX_CONTINUATIONS = 3;

type TextBlock = { type: "text"; text?: string; citations?: Array<{ type?: string; url?: string; title?: string }> | null };
type Block = TextBlock | { type: string };
type MessagesResponse = { content?: Block[]; stop_reason?: string };

/** Clave de deduplicación: la URL sin fragmento (los citadores añaden `#:~:text=...`). */
function dedupeKey(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

/** Quita la clave (y cualquier cosa con forma de clave) de un mensaje antes de mostrarlo. */
function redact(message: string, apiKey: string): string {
  return message.split(apiKey).join("[clave]").replace(/sk-[A-Za-z0-9_*.-]{6,}/g, "[clave]");
}

function buildTool(o: AnthropicProviderOptions): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: o.toolType ?? DEFAULT_TOOL,
    name: "web_search",
    max_uses: o.maxSearches ?? 5,
    // Sin filtrado dinámico: la búsqueda no pasa por ejecución de código y la respuesta es más simple.
    allowed_callers: ["direct"],
  };
  const loc = o.location;
  if (loc && (loc.country || loc.city || loc.region)) {
    tool.user_location = {
      type: "approximate",
      ...(loc.city ? { city: loc.city } : {}),
      ...(loc.region ? { region: loc.region } : {}),
      ...(loc.country ? { country: loc.country.toUpperCase() } : {}),
    };
  }
  return tool;
}

/** Texto de los bloques `text` y citas `web_search_result_location` (url y título) de una respuesta. */
export function parseAnthropicContent(blocks: Block[]): { text: string; citations: Citation[] } {
  let text = "";
  const citations: Citation[] = [];
  for (const block of blocks) {
    if (block.type !== "text") continue;
    const b = block as TextBlock;
    text += b.text ?? "";
    for (const c of b.citations ?? []) {
      if (c.type === "web_search_result_location" && c.url) citations.push(c.title ? { url: c.url, title: c.title } : { url: c.url });
    }
  }
  return { text, citations };
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): Provider {
  if (!opts.apiKey) throw new Error("Falta la clave de Anthropic (apiKey).");
  const { apiKey } = opts;
  const tool = buildTool(opts);

  return {
    name: "anthropic",
    async ask(q: ProbeQuestion): Promise<ProbeAnswer> {
      const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: q.prompt }];
      let text = "";
      const found = new Map<string, Citation>();

      try {
        for (let round = 0; ; round++) {
          const res = await requestJson<MessagesResponse>({
            label: "anthropic:messages",
            url: ENDPOINT,
            headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION },
            body: { model: opts.model ?? DEFAULT_MODEL, max_tokens: 8000, tools: [tool], messages },
            timeoutMs: TIMEOUT_MS,
            fetchImpl: opts.fetchImpl,
            recorder: opts.recorder,
            sleep: opts.sleep,
          });
          const content = res.content ?? [];
          const part = parseAnthropicContent(content);
          text += part.text;
          for (const c of part.citations) {
            const key = dedupeKey(c.url);
            const prev = found.get(key);
            if (!prev) found.set(key, c);
            else if (!prev.title && c.title) prev.title = c.title;
          }
          // La búsqueda larga puede pausarse: se devuelve el mensaje tal cual para que continúe.
          if (res.stop_reason !== "pause_turn" || round >= MAX_CONTINUATIONS) break;
          messages.push({ role: "assistant", content });
        }
      } catch (error) {
        if (error instanceof SpikeHttpError) throw new SpikeHttpError(error.code, error.status, redact(error.message, apiKey));
        throw error;
      }
      return { text: text.trim(), citations: [...found.values()] };
    },
  };
}
