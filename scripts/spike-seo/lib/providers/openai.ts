import { requestJson, SpikeHttpError, type Ctx } from "../http";
import type { Citation, ProbeAnswer, ProbeQuestion, Provider } from "../probe";

/**
 * Proveedor de sondeo con la Responses API de OpenAI y su herramienta `web_search`.
 * Documentación: https://developers.openai.com/api/docs/guides/tools-web-search
 */

export type ApproximateLocation = { country?: string; city?: string; region?: string };

export type OpenAIProviderOptions = Ctx & {
  apiKey: string;
  /** Por defecto `gpt-6-astra`, el modelo que la documentación recomienda para búsqueda web con la Responses API. */
  model?: string;
  location?: ApproximateLocation;
};

const ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6-astra";
/** La búsqueda web tarda: tiempo máximo largo por petición. */
const TIMEOUT_MS = 90_000;

type Annotation = { type?: string; url?: string; title?: string };
type OutputItem = {
  type?: string;
  content?: Array<{ type?: string; text?: string; annotations?: Annotation[] | null }> | null;
};
type ResponsesResponse = { status?: string; error?: { message?: string } | null; output?: OutputItem[] | null };

/** Clave de deduplicación: la URL sin fragmento (OpenAI añade `#:~:text=...` a algunas citas). */
function dedupeKey(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

/** Quita la clave (y cualquier cosa con forma de clave, incluida la enmascarada que devuelve OpenAI) de un mensaje. */
function redact(message: string, apiKey: string): string {
  return message.split(apiKey).join("[clave]").replace(/sk-[A-Za-z0-9_*.-]{6,}/g, "[clave]");
}

/** Texto de los `output_text` de los mensajes y citas `url_citation` (url y título), sin repetir URLs. */
export function parseOpenAIOutput(output: OutputItem[]): { text: string; citations: Citation[] } {
  const messages: string[] = [];
  const found = new Map<string, Citation>();
  for (const item of output) {
    if (item.type !== "message") continue;
    let text = "";
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      text += part.text ?? "";
      for (const a of part.annotations ?? []) {
        if (a.type !== "url_citation" || !a.url) continue;
        const key = dedupeKey(a.url);
        const prev = found.get(key);
        if (!prev) found.set(key, a.title ? { url: a.url, title: a.title } : { url: a.url });
        else if (!prev.title && a.title) prev.title = a.title;
      }
    }
    if (text) messages.push(text);
  }
  return { text: messages.join("\n\n").trim(), citations: [...found.values()] };
}

export function createOpenAIProvider(opts: OpenAIProviderOptions): Provider {
  if (!opts.apiKey) throw new Error("Falta la clave de OpenAI (apiKey).");
  const { apiKey } = opts;

  const tool: Record<string, unknown> = { type: "web_search" };
  const loc = opts.location;
  if (loc && (loc.country || loc.city || loc.region)) {
    tool.user_location = {
      type: "approximate",
      ...(loc.country ? { country: loc.country.toUpperCase() } : {}),
      ...(loc.city ? { city: loc.city } : {}),
      ...(loc.region ? { region: loc.region } : {}),
    };
  }

  return {
    name: "openai",
    async ask(q: ProbeQuestion): Promise<ProbeAnswer> {
      let res: ResponsesResponse;
      try {
        res = await requestJson<ResponsesResponse>({
          label: "openai:responses",
          url: ENDPOINT,
          headers: { Authorization: `Bearer ${apiKey}` },
          // `store: false`: la pregunta del sondeo no se guarda en la cuenta.
          body: { model: opts.model ?? DEFAULT_MODEL, input: q.prompt, tools: [tool], store: false },
          timeoutMs: TIMEOUT_MS,
          fetchImpl: opts.fetchImpl,
          recorder: opts.recorder,
          sleep: opts.sleep,
        });
      } catch (error) {
        if (error instanceof SpikeHttpError) throw new SpikeHttpError(error.code, error.status, redact(error.message, apiKey));
        throw error;
      }
      if (res.status === "failed") {
        throw new SpikeHttpError("UNAVAILABLE", 200, `openai:responses: la respuesta falló. ${redact(res.error?.message ?? "", apiKey)}`.trim());
      }
      return parseOpenAIOutput(res.output ?? []);
    },
  };
}
