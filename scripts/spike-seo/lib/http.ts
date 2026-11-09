/** Lo único que se usa de `fetch`; se puede sustituir en pruebas. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ErrorCode = "AUTH" | "FORBIDDEN" | "NOT_FOUND" | "QUOTA" | "BAD_REQUEST" | "UNAVAILABLE";

export class SpikeHttpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SpikeHttpError";
  }
}

export type CallRecord = { label: string; status: number; ms: number; attempt: number };

/** Anota cada llamada para medir tiempos, reintentos y cuota (una de las preguntas del piloto). */
export class Recorder {
  readonly calls: CallRecord[] = [];

  add(call: CallRecord): void {
    this.calls.push(call);
  }

  summary(): Array<{ label: string; calls: number; totalMs: number; statuses: Record<string, number> }> {
    const byLabel = new Map<string, { label: string; calls: number; totalMs: number; statuses: Record<string, number> }>();
    for (const c of this.calls) {
      const entry = byLabel.get(c.label) ?? { label: c.label, calls: 0, totalMs: 0, statuses: {} };
      entry.calls += 1;
      entry.totalMs += c.ms;
      entry.statuses[String(c.status)] = (entry.statuses[String(c.status)] ?? 0) + 1;
      byLabel.set(c.label, entry);
    }
    return [...byLabel.values()];
  }
}

export type Ctx = { fetchImpl?: FetchLike; recorder?: Recorder; sleep?: (ms: number) => Promise<void> };

export type RequestOptions = Ctx & {
  label: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Un objeto se envía como JSON; `URLSearchParams`, como formulario. */
  body?: unknown;
  timeoutMs?: number;
  /** Reintentos ante 429 y errores 5xx (con espera creciente). */
  retries?: number;
};

function codeFor(status: number): ErrorCode {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "AUTH";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "QUOTA";
  return "UNAVAILABLE";
}

/** Mensaje de error de la API sin cabeceras ni credenciales; recortado. */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    const message = typeof parsed.error === "string" ? parsed.error_description ?? parsed.error : parsed.error?.message;
    if (message) return message.slice(0, 300);
  } catch {
    // No era JSON.
  }
  return text.slice(0, 300);
}

/** Petición JSON con tiempo máximo, reintentos y errores tipados (mismo criterio que `services/crux.ts`). */
export async function requestJson<T>(o: RequestOptions): Promise<T> {
  const fetchImpl = o.fetchImpl ?? (fetch as FetchLike);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = o.retries ?? 2;
  const isForm = o.body instanceof URLSearchParams;

  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetchImpl(o.url, {
        method: o.method ?? (o.body === undefined ? "GET" : "POST"),
        headers: { ...(o.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}), ...o.headers },
        body: o.body === undefined ? undefined : isForm ? (o.body as URLSearchParams) : JSON.stringify(o.body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      });
    } catch {
      o.recorder?.add({ label: o.label, status: 0, ms: Date.now() - started, attempt });
      if (attempt <= retries) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new SpikeHttpError("UNAVAILABLE", 0, `No se pudo contactar con el servicio (${o.label}).`);
    }
    o.recorder?.add({ label: o.label, status: res.status, ms: Date.now() - started, attempt });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt <= retries) {
      await sleep(1000 * attempt);
      continue;
    }
    throw new SpikeHttpError(codeFor(res.status), res.status, `${o.label}: HTTP ${res.status}. ${await errorDetail(res)}`.trim());
  }
}
