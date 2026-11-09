import { requestJson, type Ctx } from "./http";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const BASE = "https://www.googleapis.com/webmasters/v3";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
/** Máximo de filas que la API entrega por petición. */
export const GSC_ROW_LIMIT = 25_000;

export type GscCtx = Ctx & { token: string };

const headers = (c: GscCtx) => ({ Authorization: `Bearer ${c.token}` });
const site = (s: string) => encodeURIComponent(s);

export type GscSite = { siteUrl: string; permissionLevel: string };

export async function listSites(c: GscCtx): Promise<GscSite[]> {
  const res = await requestJson<{ siteEntry?: GscSite[] }>({ ...c, label: "gsc-sites", url: `${BASE}/sites`, headers: headers(c) });
  return res.siteEntry ?? [];
}

export type GscSitemap = { path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; errors?: string; warnings?: string };

export async function listSitemaps(c: GscCtx, siteUrl: string): Promise<GscSitemap[]> {
  const res = await requestJson<{ sitemap?: GscSitemap[] }>({ ...c, label: "gsc-sitemaps", url: `${BASE}/sites/${site(siteUrl)}/sitemaps`, headers: headers(c) });
  return res.sitemap ?? [];
}

export type GscRecord = { keys: Record<string, string>; clicks: number; impressions: number; ctr: number; position: number };

export type SearchQuery = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  /** Filas por petición (máx. 25.000). */
  rowLimit?: number;
  /** Tope total para no descargar de más en una prueba. */
  maxRows?: number;
  /** `final` solo trae días cerrados; `all` incluye los frescos (útil para medir el retraso). */
  dataState?: "final" | "all";
  searchType?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
};

export type SearchResult = { records: GscRecord[]; truncated: boolean; requests: number };

/** Rendimiento de búsqueda paginando con `startRow` hasta agotar los datos o llegar a `maxRows`. */
export async function searchAnalytics(c: GscCtx, siteUrl: string, q: SearchQuery): Promise<SearchResult> {
  const rowLimit = Math.min(q.rowLimit ?? GSC_ROW_LIMIT, GSC_ROW_LIMIT);
  const maxRows = q.maxRows ?? 100_000;
  const records: GscRecord[] = [];
  let requests = 0;
  let truncated = false;

  for (let startRow = 0; ; startRow += rowLimit) {
    const res = await requestJson<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> }>({
      ...c,
      label: "gsc-search",
      url: `${BASE}/sites/${site(siteUrl)}/searchAnalytics/query`,
      headers: headers(c),
      body: {
        startDate: q.startDate,
        endDate: q.endDate,
        dimensions: q.dimensions,
        rowLimit,
        startRow,
        dataState: q.dataState ?? "final",
        ...(q.searchType ? { type: q.searchType } : {}),
      },
    });
    requests += 1;
    const rows = res.rows ?? [];
    for (const r of rows) {
      const keys: Record<string, string> = {};
      q.dimensions.forEach((d, i) => {
        keys[d] = r.keys[i] ?? "";
      });
      records.push({ keys, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    }
    if (rows.length < rowLimit) break;
    if (records.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  return { records, truncated, requests };
}

/** Resultado de la URL Inspection API (indexación, canónica, rich results…). Cuota: unas 2.000 al día por propiedad. */
export async function inspectUrl(c: GscCtx, siteUrl: string, url: string, languageCode = "es"): Promise<unknown> {
  const res = await requestJson<{ inspectionResult?: unknown }>({
    ...c,
    label: "gsc-inspect",
    url: INSPECT_URL,
    headers: headers(c),
    body: { inspectionUrl: url, siteUrl, languageCode },
  });
  return res.inspectionResult ?? null;
}
