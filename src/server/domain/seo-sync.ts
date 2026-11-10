import { classifySource } from "./seo-sources";
import { pagePath } from "@/server/seo/urls";

/**
 * Descarga de Search Console y GA4: qué fechas pedir y cómo reducir las filas de Google a las que se guardan.
 * Lógica pura (sin red ni base de datos).
 */

/** Días que se piden la primera vez, para que el panel nazca con historial. */
export const INITIAL_DAYS = 90;
/** Search Console conserva unos 16 meses: no se pide más atrás aunque la última descarga sea muy antigua. */
export const MAX_BACKFILL_DAYS = 480;
/** Días de tamaño de cada petición grande: así un fallo a la mitad no pierde lo ya descargado. */
export const CHUNK_DAYS = 30;
/** Cada descarga repasa los últimos días ya guardados, porque Google los corrige con retraso. */
export const REFRESH_DAYS = 7;
/** Días que Google tarda en tener cerrados los datos más recientes. */
export const LAG_DAYS = { gsc: 3, ga4: 1 } as const;

export type SyncKind = keyof typeof LAG_DAYS;
export type DateWindow = { from: string; to: string };

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfDay = (d: Date) => Date.parse(isoDay(d.getTime()));

/**
 * Ventanas de fechas (de hasta 30 días, de la más antigua a la más reciente) que toca descargar. La primera vez, los
 * últimos 90 días; después, desde una semana antes del último día guardado hasta el último día cerrado por Google.
 */
export function planSyncWindows(syncedThrough: string | null, kind: SyncKind, now: Date): DateWindow[] {
  const end = startOfDay(now) - LAG_DAYS[kind] * DAY_MS;
  const floor = end - (MAX_BACKFILL_DAYS - 1) * DAY_MS;
  const wanted = syncedThrough ? Math.min(Date.parse(syncedThrough) - (REFRESH_DAYS - 1) * DAY_MS, end) : end - (INITIAL_DAYS - 1) * DAY_MS;
  const start = Math.max(wanted, floor);
  const windows: DateWindow[] = [];
  for (let from = start; from <= end; from += CHUNK_DAYS * DAY_MS) {
    windows.push({ from: isoDay(from), to: isoDay(Math.min(from + (CHUNK_DAYS - 1) * DAY_MS, end)) });
  }
  return windows;
}

export type SearchRow = { date: string; page: string; country: string; device: string; clicks: number; impressions: number; positionSum: number };
export type TrafficRow = { date: string; page: string; country: string; channel: string; sessions: number; users: number };
export type AiRow = { date: string; source: string; page: string; sessions: number; users: number };
export type SourceRow = { date: string; grp: string; source: string; page: string; sessions: number; users: number };
export type QueryRow = { date: string; query: string; clicks: number; impressions: number; positionSum: number };

type GscRecordLike = { keys: Record<string, string>; clicks: number; impressions: number; position: number };
type Ga4RowLike = { dims: Record<string, string>; metrics: Record<string, number> };

/** GA4 entrega las fechas como `20261101`. */
export function ga4Date(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

/**
 * Reduce las filas de Search Console a las que se guardan: la página pasa a ruta normalizada (así `/precios/` y
 * `/precios?x=1` se suman) y se guarda la posición × impresiones para poder promediar después.
 */
export function aggregateSearch(records: GscRecordLike[]): SearchRow[] {
  const out = new Map<string, SearchRow>();
  for (const r of records) {
    const date = r.keys.date ?? "";
    const page = pagePath(r.keys.page ?? "");
    const country = (r.keys.country ?? "").toLowerCase();
    const device = (r.keys.device ?? "").toUpperCase();
    const key = `${date}|${page}|${country}|${device}`;
    const row = out.get(key) ?? { date, page, country, device, clicks: 0, impressions: 0, positionSum: 0 };
    row.clicks += Math.round(r.clicks);
    row.impressions += Math.round(r.impressions);
    row.positionSum += r.position * r.impressions;
    out.set(key, row);
  }
  return [...out.values()];
}

export function aggregateTraffic(rows: Ga4RowLike[]): TrafficRow[] {
  const out = new Map<string, TrafficRow>();
  for (const r of rows) {
    const date = ga4Date(r.dims.date ?? "");
    const page = pagePath(r.dims.pagePath ?? "");
    const country = r.dims.country || "(not set)";
    const channel = r.dims.sessionDefaultChannelGroup || "Unassigned";
    const key = `${date}|${page}|${country}|${channel}`;
    const row = out.get(key) ?? { date, page, country, channel, sessions: 0, users: 0 };
    row.sessions += r.metrics.sessions ?? 0;
    row.users += r.metrics.totalUsers ?? 0;
    out.set(key, row);
  }
  return [...out.values()];
}

export function aggregateAi(rows: Ga4RowLike[]): AiRow[] {
  const out = new Map<string, AiRow>();
  for (const r of rows) {
    const date = ga4Date(r.dims.date ?? "");
    const source = (r.dims.sessionSource ?? "").toLowerCase();
    const page = pagePath(r.dims.pagePath ?? "");
    const key = `${date}|${source}|${page}`;
    const row = out.get(key) ?? { date, source, page, sessions: 0, users: 0 };
    row.sessions += r.metrics.sessions ?? 0;
    row.users += r.metrics.totalUsers ?? 0;
    out.set(key, row);
  }
  return [...out.values()];
}

/**
 * Reduce las filas de GA4 por fuente y grupo de canal al **reparto completo**: cada fila va a un solo grupo y una sola fuente
 * (`classifySource`), con la fecha y la página normalizadas. La suma de todo es el total de sesiones.
 */
export function aggregateSources(rows: Ga4RowLike[]): SourceRow[] {
  const out = new Map<string, SourceRow>();
  for (const r of rows) {
    const { group, key } = classifySource(r.dims.sessionSource ?? "", r.dims.sessionDefaultChannelGroup ?? "");
    const date = ga4Date(r.dims.date ?? "");
    const page = pagePath(r.dims.pagePath ?? "");
    const id = `${date}|${group}|${key}|${page}`;
    const row = out.get(id) ?? { date, grp: group, source: key, page, sessions: 0, users: 0 };
    row.sessions += r.metrics.sessions ?? 0;
    row.users += r.metrics.totalUsers ?? 0;
    out.set(id, row);
  }
  return [...out.values()];
}

/** Las consultas con más clics que se guardan de cada día. */
export const QUERIES_PER_DAY = 50;

/**
 * Reduce las filas de Search Console por día y consulta: la consulta se normaliza (minúsculas, espacios) y de cada día se
 * guardan las `QUERIES_PER_DAY` con más clics (a igualdad, más impresiones). La posición se guarda × impresiones.
 */
export function aggregateQueries(records: GscRecordLike[]): QueryRow[] {
  const byKey = new Map<string, QueryRow>();
  for (const r of records) {
    const date = r.keys.date ?? "";
    const query = (r.keys.query ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!date || !query) continue;
    const id = `${date}|${query}`;
    const row = byKey.get(id) ?? { date, query, clicks: 0, impressions: 0, positionSum: 0 };
    row.clicks += r.clicks;
    row.impressions += r.impressions;
    row.positionSum += r.position * r.impressions;
    byKey.set(id, row);
  }
  const perDay = new Map<string, QueryRow[]>();
  for (const row of byKey.values()) perDay.set(row.date, [...(perDay.get(row.date) ?? []), row]);
  return [...perDay.values()].flatMap((list) => list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query)).slice(0, QUERIES_PER_DAY));
}
