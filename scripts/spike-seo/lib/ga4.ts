import { requestJson, type Ctx } from "./http";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type Ga4Ctx = Ctx & { token: string };

/** Fuentes de sesión que se consideran asistentes de IA. Los enlaces de ChatGPT con `utm_source` llegan como `chatgpt.com`. */
export const AI_SOURCE_REGEX = "chatgpt\\.com|chat\\.openai\\.com|perplexity|claude\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com";

/** Filtro de GA4: sesiones cuya fuente coincide con un asistente de IA. */
export const aiSourceFilter = {
  filter: { fieldName: "sessionSource", stringFilter: { matchType: "PARTIAL_REGEXP", value: AI_SOURCE_REGEX, caseSensitive: false } },
};

/** ¿Esta fuente de sesión es un asistente de IA? Misma regla que `aiSourceFilter`, para clasificar en local. */
export function isAiSource(source: string): boolean {
  return new RegExp(AI_SOURCE_REGEX, "i").test(source);
}

export type Ga4Report = {
  dimensions: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  dimensionFilter?: unknown;
  /** Filas por petición (GA4 admite hasta 250.000). */
  pageSize?: number;
  maxRows?: number;
};

export type Ga4Row = { dims: Record<string, string>; metrics: Record<string, number> };
export type Ga4Result = { rows: Ga4Row[]; rowCount: number | null; truncated: boolean; requests: number };

/** Informe de la Google Analytics Data API paginando con `offset`. */
export async function runReport(c: Ga4Ctx, property: string, q: Ga4Report): Promise<Ga4Result> {
  if (!/^\d+$/.test(property)) throw new Error("SPIKE_GA4_PROPERTY debe ser el ID numérico de la propiedad (no el ID de medición G-XXXX).");
  const pageSize = q.pageSize ?? 10_000;
  const maxRows = q.maxRows ?? 100_000;
  const rows: Ga4Row[] = [];
  let rowCount: number | null = null;
  let requests = 0;
  let truncated = false;

  for (let offset = 0; ; offset += pageSize) {
    const res = await requestJson<{ rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>; rowCount?: number }>({
      ...c,
      label: "ga4-report",
      url: `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
      headers: { Authorization: `Bearer ${c.token}` },
      body: {
        dateRanges: [{ startDate: q.startDate, endDate: q.endDate }],
        dimensions: q.dimensions.map((name) => ({ name })),
        metrics: q.metrics.map((name) => ({ name })),
        ...(q.dimensionFilter ? { dimensionFilter: q.dimensionFilter } : {}),
        limit: pageSize,
        offset,
      },
    });
    requests += 1;
    rowCount = res.rowCount ?? rowCount;
    const page = res.rows ?? [];
    for (const r of page) {
      const dims: Record<string, string> = {};
      const metrics: Record<string, number> = {};
      q.dimensions.forEach((d, i) => {
        dims[d] = r.dimensionValues?.[i]?.value ?? "";
      });
      q.metrics.forEach((m, i) => {
        metrics[m] = Number(r.metricValues?.[i]?.value ?? 0);
      });
      rows.push({ dims, metrics });
    }
    if (page.length < pageSize || (rowCount !== null && offset + pageSize >= rowCount)) break;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  return { rows, rowCount, truncated, requests };
}
