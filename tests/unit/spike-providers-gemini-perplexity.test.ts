import { describe, expect, it, vi } from "vitest";
import { Recorder, SpikeHttpError, type FetchLike } from "../../scripts/spike-seo/lib/http";
import { createGeminiProvider, GEMINI_DEFAULT_MODEL } from "../../scripts/spike-seo/lib/providers/gemini";
import { createPerplexityProvider, PERPLEXITY_DEFAULT_MODEL } from "../../scripts/spike-seo/lib/providers/perplexity";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => undefined;
const KEY = "clave-secreta-de-prueba-123";

/** Primera llamada registrada en un `fetch` simulado: URL, cabeceras y cuerpo ya interpretado. */
function firstCall(fetchImpl: ReturnType<typeof vi.fn<FetchLike>>) {
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  return { url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
}

const geminiSample = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [{ text: "Italia ganó el Euro 2020. " }, { text: "España ganó la Eurocopa 2024.", thought: false }, { text: "razonamiento interno", thought: true }],
      },
      finishReason: "STOP",
      groundingMetadata: {
        webSearchQueries: ["quién ganó la eurocopa 2024"],
        searchEntryPoint: { renderedContent: "<div>...</div>" },
        groundingChunks: [
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "aljazeera.com" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB", title: "uefa.com" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "aljazeera.com" } },
          { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/CCC" } },
          { web: {} },
        ],
        groundingSupports: [{ segment: { startIndex: 0, endIndex: 20, text: "Italia" }, groundingChunkIndices: [0, 1] }],
      },
    },
  ],
};

describe("proveedor Gemini", () => {
  it("envía la clave en cabecera, no en la URL, con la herramienta google_search y el prompt tal cual", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(geminiSample));
    const provider = createGeminiProvider({ apiKey: KEY, fetchImpl, sleep: noSleep });
    expect(provider.name).toBe("gemini");

    await provider.ask({ lang: "es", prompt: "¿Quién ganó la Eurocopa 2024?" });

    const call = firstCall(fetchImpl);
    expect(call.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
    expect(call.url).not.toContain(KEY);
    expect(call.url).not.toContain("key=");
    expect(call.headers["x-goog-api-key"]).toBe(KEY);
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "¿Quién ganó la Eurocopa 2024?" }] }],
      tools: [{ google_search: {} }],
    });
  });

  it("respeta el modelo indicado y anota la llamada", async () => {
    const recorder = new Recorder();
    const fetchImpl = vi.fn<FetchLike>(async () => json(geminiSample));
    await createGeminiProvider({ apiKey: KEY, model: "gemini-2.5-flash", fetchImpl, recorder, sleep: noSleep }).ask({ lang: "es", prompt: "x" });
    expect(firstCall(fetchImpl).url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(recorder.summary()[0]).toMatchObject({ label: "gemini:generateContent", calls: 1 });
  });

  it("extrae el texto sin razonamiento y las fuentes sin duplicar URLs", async () => {
    const provider = createGeminiProvider({ apiKey: KEY, fetchImpl: async () => json(geminiSample), sleep: noSleep });
    const answer = await provider.ask({ lang: "es", prompt: "x" });
    expect(answer.text).toBe("Italia ganó el Euro 2020. España ganó la Eurocopa 2024.");
    expect(answer.citations).toEqual([
      { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "aljazeera.com" },
      { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB", title: "uefa.com" },
      { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/CCC" },
    ]);
  });

  it("devuelve texto vacío y sin fuentes si no hay candidatos (respuesta bloqueada)", async () => {
    const provider = createGeminiProvider({ apiKey: KEY, fetchImpl: async () => json({ promptFeedback: { blockReason: "SAFETY" } }), sleep: noSleep });
    expect(await provider.ask({ lang: "es", prompt: "x" })).toEqual({ text: "", citations: [] });
  });

  it.each([401, 403])("un %i no filtra la clave aunque la API la repita", async (status) => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ error: { code: status, message: `API key not valid: ${KEY}`, status: "PERMISSION_DENIED" } }, status));
    const provider = createGeminiProvider({ apiKey: KEY, fetchImpl, sleep: noSleep });
    const err = await provider.ask({ lang: "es", prompt: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpikeHttpError);
    expect(err).toMatchObject({ status, code: status === 401 ? "AUTH" : "FORBIDDEN" });
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reintenta un 503 antes de dar la respuesta", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(geminiSample));
    const answer = await createGeminiProvider({ apiKey: KEY, fetchImpl, sleep: noSleep }).ask({ lang: "es", prompt: "x" });
    expect(answer.text).toContain("España");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

const perplexitySample = {
  id: "9a8b7c6d-0000-4000-8000-000000000000",
  model: "sonar",
  created: 1_760_000_000,
  object: "chat.completion",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Las novedades de los agentes de IA incluyen **modelos más potentes** [1][2]." } }],
  citations: ["https://www.itechmagazine.com/ai-agents-news/", "https://ejemplo.com/b", "https://ejemplo.com/c"],
  search_results: [
    { title: "AI Agents News 2026", url: "https://www.itechmagazine.com/ai-agents-news/", date: "2026-06-14", last_updated: "2026-06-21", snippet: "…", source: "web" },
    { title: "Segunda fuente", url: "https://ejemplo.com/b", date: null, last_updated: null, snippet: "…", source: "web" },
    { title: "Repetida", url: "https://ejemplo.com/b", source: "web" },
    { url: "https://ejemplo.com/sin-titulo", source: "web" },
  ],
};

describe("proveedor Perplexity", () => {
  it("envía Bearer, el modelo sonar y el prompt tal cual", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(perplexitySample));
    const provider = createPerplexityProvider({ apiKey: KEY, fetchImpl, sleep: noSleep });
    expect(provider.name).toBe("perplexity");

    await provider.ask({ lang: "en", prompt: "What are the latest developments in AI agents?" });

    const call = firstCall(fetchImpl);
    expect(call.url).toBe("https://api.perplexity.ai/v1/sonar");
    expect(call.url).not.toContain(KEY);
    expect(call.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toEqual({ model: PERPLEXITY_DEFAULT_MODEL, messages: [{ role: "user", content: "What are the latest developments in AI agents?" }] });
    expect(PERPLEXITY_DEFAULT_MODEL).toBe("sonar");
  });

  it("respeta el modelo indicado y anota la llamada", async () => {
    const recorder = new Recorder();
    const fetchImpl = vi.fn<FetchLike>(async () => json(perplexitySample));
    await createPerplexityProvider({ apiKey: KEY, model: "sonar-pro", fetchImpl, recorder, sleep: noSleep }).ask({ lang: "es", prompt: "x" });
    expect(firstCall(fetchImpl).body.model).toBe("sonar-pro");
    expect(recorder.summary()[0]).toMatchObject({ label: "perplexity:sonar", calls: 1 });
  });

  it("une search_results y citations sin duplicar URLs, conservando los títulos", async () => {
    const provider = createPerplexityProvider({ apiKey: KEY, fetchImpl: async () => json(perplexitySample), sleep: noSleep });
    const answer = await provider.ask({ lang: "es", prompt: "x" });
    expect(answer.text).toContain("modelos más potentes");
    expect(answer.citations).toEqual([
      { url: "https://www.itechmagazine.com/ai-agents-news/", title: "AI Agents News 2026" },
      { url: "https://ejemplo.com/b", title: "Segunda fuente" },
      { url: "https://ejemplo.com/sin-titulo" },
      { url: "https://ejemplo.com/c" },
    ]);
  });

  it("acepta una respuesta con solo citations o sin nada", async () => {
    const soloCitas = createPerplexityProvider({
      apiKey: KEY,
      fetchImpl: async () => json({ choices: [{ message: { content: "ok" } }], citations: ["https://a.test/", "https://a.test/"] }),
      sleep: noSleep,
    });
    expect(await soloCitas.ask({ lang: "es", prompt: "x" })).toEqual({ text: "ok", citations: [{ url: "https://a.test/" }] });

    const vacia = createPerplexityProvider({ apiKey: KEY, fetchImpl: async () => json({}), sleep: noSleep });
    expect(await vacia.ask({ lang: "es", prompt: "x" })).toEqual({ text: "", citations: [] });
  });

  it.each([401, 403])("un %i no filtra la clave aunque la API la repita", async (status) => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ error: { message: `Invalid key ${KEY}`, type: "invalid_api_key" } }, status));
    const provider = createPerplexityProvider({ apiKey: KEY, fetchImpl, sleep: noSleep });
    const err = await provider.ask({ lang: "es", prompt: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpikeHttpError);
    expect(err).toMatchObject({ status, code: status === 401 ? "AUTH" : "FORBIDDEN" });
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
