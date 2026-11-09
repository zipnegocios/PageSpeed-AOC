import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../scripts/spike-seo/lib/http";
import { Recorder, SpikeHttpError } from "../../scripts/spike-seo/lib/http";
import { createAnthropicProvider } from "../../scripts/spike-seo/lib/providers/anthropic";
import { createOpenAIProvider } from "../../scripts/spike-seo/lib/providers/openai";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => undefined;
const q = { lang: "es", prompt: "¿Qué agencia de SEO recomiendas en Madrid?" };

describe("proveedor Anthropic", () => {
  const KEY = "sk-ant-api03-CLAVE-SECRETA-DE-PRUEBA";
  // Respuesta con la forma de la documentación de la herramienta de búsqueda web.
  const shannon = {
    role: "assistant",
    stop_reason: "end_turn",
    content: [
      { type: "text", text: "I'll search for when Claude Shannon was born." },
      { type: "server_tool_use", id: "srvtoolu_01", name: "web_search", input: { query: "claude shannon birth date" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_01",
        content: [{ type: "web_search_result", url: "https://en.wikipedia.org/wiki/Claude_Shannon", title: "Claude Shannon - Wikipedia", encrypted_content: "Eqgf...", page_age: "April 30, 2025" }],
      },
      { type: "text", text: "Based on the search results, " },
      {
        type: "text",
        text: "Claude Shannon was born on April 30, 1916",
        citations: [
          { type: "web_search_result_location", url: "https://en.wikipedia.org/wiki/Claude_Shannon", title: "Claude Shannon - Wikipedia", encrypted_index: "Eo8B...", cited_text: "Claude Elwood Shannon (April 30, 1916 ..." },
        ],
      },
      {
        type: "text",
        text: " in Petoskey, Michigan.",
        citations: [
          { type: "web_search_result_location", url: "https://en.wikipedia.org/wiki/Claude_Shannon", title: "Claude Shannon - Wikipedia", encrypted_index: "Eo9C...", cited_text: "..." },
          { type: "web_search_result_location", url: "https://www.britannica.com/biography/Claude-Shannon#:~:text=born", title: "Claude Shannon | Britannica", encrypted_index: "Ep1D...", cited_text: "..." },
          { type: "web_search_result_location", url: "https://www.britannica.com/biography/Claude-Shannon", encrypted_index: "Ep2E...", cited_text: "..." },
        ],
      },
    ],
  };

  it("envía la petición con las cabeceras, la herramienta y el prompt tal cual", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(shannon));
    const recorder = new Recorder();
    const provider = createAnthropicProvider({ apiKey: KEY, fetchImpl, recorder, sleep: noSleep });
    expect(provider.name).toBe("anthropic");
    await provider.ask(q);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-api-key": KEY, "anthropic-version": "2026-10-21", "Content-Type": "application/json" });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.messages).toEqual([{ role: "user", content: q.prompt }]);
    expect(body.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_callers: ["direct"] }]);
    expect(body.max_tokens).toEqual(expect.any(Number));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(recorder.calls[0]).toMatchObject({ label: "anthropic:messages", status: 200 });
  });

  it("extrae el texto y las citas sin repetir URLs (ni por fragmento) y conserva el título", async () => {
    const provider = createAnthropicProvider({ apiKey: KEY, fetchImpl: async () => json(shannon), sleep: noSleep });
    const out = await provider.ask(q);
    expect(out.text).toBe("I'll search for when Claude Shannon was born.Based on the search results, Claude Shannon was born on April 30, 1916 in Petoskey, Michigan.");
    expect(out.citations).toEqual([
      { url: "https://en.wikipedia.org/wiki/Claude_Shannon", title: "Claude Shannon - Wikipedia" },
      { url: "https://www.britannica.com/biography/Claude-Shannon#:~:text=born", title: "Claude Shannon | Britannica" },
    ]);
  });

  it("incluye la ubicación aproximada, el modelo y el tipo de herramienta indicados", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(shannon));
    const provider = createAnthropicProvider({ apiKey: KEY, fetchImpl, model: "claude-haiku-5-5", toolType: "web_search_20250305", maxSearches: 2, location: { country: "es", city: "Madrid", region: "Madrid" } });
    await provider.ask(q);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as { model: string; tools: unknown[] };
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 2, allowed_callers: ["direct"], user_location: { type: "approximate", city: "Madrid", region: "Madrid", country: "ES" } },
    ]);
  });

  it("reanuda una respuesta pausada (pause_turn) devolviendo el mensaje intacto y acumula texto y citas", async () => {
    const paused = {
      stop_reason: "pause_turn",
      content: [
        { type: "text", text: "Buscando. " },
        { type: "server_tool_use", id: "srvtoolu_02", name: "web_search", input: { query: "x" } },
      ],
    };
    const done = { stop_reason: "end_turn", content: [{ type: "text", text: "Listo.", citations: [{ type: "web_search_result_location", url: "https://a.test/x", title: "A" }] }] };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(json(paused)).mockResolvedValueOnce(json(done));
    const out = await createAnthropicProvider({ apiKey: KEY, fetchImpl, sleep: noSleep }).ask(q);
    expect(out).toEqual({ text: "Buscando. Listo.", citations: [{ url: "https://a.test/x", title: "A" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)) as { messages: Array<{ role: string; content: unknown }> };
    expect(second.messages).toEqual([
      { role: "user", content: q.prompt },
      { role: "assistant", content: paused.content },
    ]);
  });

  it("tolera una búsqueda fallida (200 con error en el resultado) y una respuesta sin citas", async () => {
    const res = {
      stop_reason: "end_turn",
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        { type: "text", text: "No pude buscar." },
      ],
    };
    const out = await createAnthropicProvider({ apiKey: KEY, fetchImpl: async () => json(res), sleep: noSleep }).ask(q);
    expect(out).toEqual({ text: "No pude buscar.", citations: [] });
  });

  it("un 401 no filtra la clave, ni aunque la API la devuelva en el mensaje", async () => {
    const fetchImpl: FetchLike = async () => json({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key: ${KEY}` } }, 401);
    const provider = createAnthropicProvider({ apiKey: KEY, fetchImpl, sleep: noSleep });
    const error = (await provider.ask(q).catch((e: unknown) => e)) as SpikeHttpError;
    expect(error).toBeInstanceOf(SpikeHttpError);
    expect(error).toMatchObject({ code: "AUTH", status: 401 });
    expect(error.message).not.toContain(KEY);
    expect(String(error.stack)).not.toContain(KEY);
    expect(error.message).toContain("anthropic:messages");
  });

  it("reintenta ante 429 y rechaza una clave vacía", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json(shannon));
    const out = await createAnthropicProvider({ apiKey: KEY, fetchImpl, sleep: noSleep }).ask(q);
    expect(out.citations).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(() => createAnthropicProvider({ apiKey: "" })).toThrow(/clave/);
  });
});

describe("proveedor OpenAI", () => {
  const KEY = "sk-proj-CLAVE-SECRETA-DE-PRUEBA-1234567890";
  // Respuesta con la forma de la documentación de la herramienta web_search de la Responses API.
  const response = {
    id: "resp_123",
    status: "completed",
    error: null,
    output: [
      { type: "web_search_call", id: "ws_67c9fa05", status: "completed", action: { type: "search", query: "agencia seo madrid" } },
      {
        type: "message",
        id: "msg_67c9fa",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Una opción es Acme SEO [acme](https://acme.test/?utm_source=openai). Otra, Rival.",
            annotations: [
              { type: "url_citation", start_index: 20, end_index: 60, url: "https://acme.test/?utm_source=openai", title: "Acme SEO" },
              { type: "url_citation", start_index: 62, end_index: 90, url: "https://acme.test/?utm_source=openai#:~:text=Acme", title: "Acme SEO" },
              { type: "url_citation", start_index: 92, end_index: 120, url: "https://rival.test/blog", title: "Rival" },
              { type: "file_citation", file_id: "file_1", index: 3 },
            ],
          },
        ],
      },
    ],
  };

  it("envía la petición a la Responses API con web_search y el prompt tal cual", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(response));
    const recorder = new Recorder();
    const provider = createOpenAIProvider({ apiKey: KEY, fetchImpl, recorder, sleep: noSleep });
    expect(provider.name).toBe("openai");
    await provider.ask(q);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-6-astra", input: q.prompt, tools: [{ type: "web_search" }], store: false });
    expect(recorder.calls[0]).toMatchObject({ label: "openai:responses", status: 200 });
  });

  it("incluye user_location aproximada cuando se indica", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(response));
    await createOpenAIProvider({ apiKey: KEY, fetchImpl, model: "gpt-5", location: { country: "es", city: "Madrid", region: "Madrid" } }).ask(q);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as { model: string; tools: unknown[] };
    expect(body.model).toBe("gpt-5");
    expect(body.tools).toEqual([{ type: "web_search", user_location: { type: "approximate", country: "ES", city: "Madrid", region: "Madrid" } }]);
  });

  it("extrae el texto y las citas url_citation, sin repetir URLs y sin contar otros tipos", async () => {
    const out = await createOpenAIProvider({ apiKey: KEY, fetchImpl: async () => json(response), sleep: noSleep }).ask(q);
    expect(out.text).toBe("Una opción es Acme SEO [acme](https://acme.test/?utm_source=openai). Otra, Rival.");
    expect(out.citations).toEqual([
      { url: "https://acme.test/?utm_source=openai", title: "Acme SEO" },
      { url: "https://rival.test/blog", title: "Rival" },
    ]);
  });

  it("une varios mensajes y devuelve vacío si no hay mensaje", async () => {
    const two = {
      status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "Uno.", annotations: [] }] },
        { type: "message", content: [{ type: "output_text", text: "Dos.", annotations: [{ type: "url_citation", url: "https://a.test" }] }] },
      ],
    };
    const provider = (body: unknown) => createOpenAIProvider({ apiKey: KEY, fetchImpl: async () => json(body), sleep: noSleep });
    expect(await provider(two).ask(q)).toEqual({ text: "Uno.\n\nDos.", citations: [{ url: "https://a.test" }] });
    expect(await provider({ status: "completed", output: [] }).ask(q)).toEqual({ text: "", citations: [] });
  });

  it("un 401 no filtra la clave, ni aunque OpenAI la devuelva enmascarada", async () => {
    const masked = "sk-proj-****************************7890";
    const fetchImpl: FetchLike = async () => json({ error: { message: `Incorrect API key provided: ${masked}. You can find your API key at ...`, type: "invalid_request_error", code: "invalid_api_key" } }, 401);
    const error = (await createOpenAIProvider({ apiKey: KEY, fetchImpl, sleep: noSleep }).ask(q).catch((e: unknown) => e)) as SpikeHttpError;
    expect(error).toBeInstanceOf(SpikeHttpError);
    expect(error).toMatchObject({ code: "AUTH", status: 401 });
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain("sk-proj");
    expect(error.message).toContain("openai:responses");
  });

  it("falla con un error tipado si la respuesta llega con status failed y reintenta ante 5xx", async () => {
    const failed = { status: "failed", error: { message: `fallo con ${KEY}` }, output: [] };
    const err = (await createOpenAIProvider({ apiKey: KEY, fetchImpl: async () => json(failed), sleep: noSleep }).ask(q).catch((e: unknown) => e)) as SpikeHttpError;
    expect(err).toBeInstanceOf(SpikeHttpError);
    expect(err.message).not.toContain(KEY);

    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(response));
    const out = await createOpenAIProvider({ apiKey: KEY, fetchImpl, sleep: noSleep }).ask(q);
    expect(out.citations).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(() => createOpenAIProvider({ apiKey: "" })).toThrow(/clave/);
  });
});
