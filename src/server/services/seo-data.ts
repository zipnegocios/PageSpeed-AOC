import { getDb, type Database } from "@/server/db/client";
import { socialLabel } from "@/server/domain/seo-social";
import { DomainError } from "@/server/domain/errors";
import {
  averagePosition,
  countryName,
  ctr,
  deviceLabel,
  fillDays,
  ga4CountryName,
  latestDate,
  periodRange,
  previousRange,
  type DateRange,
} from "@/server/domain/seo-data";
import { langLabel, NO_LANG, parseLangParam, ROOT, type Market } from "@/server/domain/seo-markets";
import * as data from "@/server/repositories/seo-data";
import * as marketsRepo from "@/server/repositories/seo-markets";
import * as integrations from "@/server/repositories/seo-integrations";
import { assertUuid } from "./shared";

export type SeoSyncInfo = {
  status: "pending" | "ok" | "error";
  /** Último día con datos guardados («AAAA-MM-DD»). */
  syncedThrough: string | null;
  lastSyncAt: Date | null;
  /** Mensaje legible de la última descarga. */
  detail: string | null;
};

export type SearchTotals = { clicks: number; impressions: number; /** Fracción: 0,05 = 5 %. */ ctr: number; /** Posición media ponderada; null sin impresiones. */ position: number | null };
export type TrafficTotals = { sessions: number; /** Suma de los usuarios diarios (un mismo usuario cuenta una vez por cada fila). */ users: number };

export type SeoDashboard = {
  /**
   * Termina en el último día con datos de cualquiera de las tres tablas, no en «hoy». Null si no hay ningún dato. Sirve para
   * saber si hay algo que mostrar; cada fuente trae su propio rango, porque Search Console y GA4 cierran con distinto retraso.
   */
  range: DateRange | null;
  previous: { from: string; to: string } | null;
  /** Estado de la última descarga de cada fuente; null si el proyecto no tiene esa conexión. */
  sync: { gsc: SeoSyncInfo | null; ga4: SeoSyncInfo | null };
  /** Idiomas declarados del proyecto (vacío si no declaró ninguno). */
  markets: Array<{ lang: string; prefix: string; isDefault: boolean; label: string }>;
  /** Idioma aplicado a todos los números (`?idioma=`), o null si se ven todos. */
  lang: string | null;
  /** Reparto por idioma de Search Console y GA4, siempre sobre todos los idiomas. Null si no hay idiomas declarados. */
  languages: Array<{ lang: string; label: string; isDefault: boolean; clicks: number; impressions: number; sessions: number }> | null;
  /** Search Console. Null si no hay filas en el periodo. */
  search: {
    /** Periodo mostrado: termina en el último día con datos de Search Console (suele ir ~3 días por detrás de hoy). */
    range: DateRange;
    previous: DateRange;
    totals: SearchTotals;
    previousTotals: SearchTotals;
    daily: Array<{ date: string; clicks: number; impressions: number }>;
    topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number | null }>;
    countries: Array<{ country: string; name: string; clicks: number; impressions: number }>;
    devices: Array<{ device: string; label: string; clicks: number; impressions: number }>;
  } | null;
  /** GA4. Null si no hay filas en el periodo. */
  traffic: {
    /** Periodo mostrado: termina en el último día con datos de GA4 (suele ir ~1 día por detrás de hoy). */
    range: DateRange;
    previous: DateRange;
    totals: TrafficTotals;
    previousTotals: TrafficTotals;
    daily: Array<{ date: string; sessions: number }>;
    channels: Array<{ channel: string; sessions: number }>;
    topPages: Array<{ page: string; sessions: number; users: number }>;
    countries: Array<{ country: string; sessions: number }>;
  } | null;
  /** Visitas que llegan desde redes sociales (GA4), por red. Null si no hay filas en el periodo. */
  social: {
    range: DateRange;
    previous: DateRange;
    totals: TrafficTotals;
    previousTotals: TrafficTotals;
    byNetwork: Array<{ network: string; label: string; sessions: number }>;
    topPages: Array<{ page: string; sessions: number }>;
  } | null;
  /** Visitas que llegan desde asistentes de IA (GA4). Null si no hay filas en el periodo. */
  ai: {
    range: DateRange;
    previous: DateRange;
    totals: TrafficTotals;
    previousTotals: TrafficTotals;
    bySource: Array<{ source: string; sessions: number }>;
    topPages: Array<{ page: string; sessions: number }>;
  } | null;
};

const TOP_PAGES = 10;
const TOP_COUNTRIES = 8;
const TOP_CHANNELS = 10;
const TOP_AI_SOURCES = 10;
const TOP_AI_PAGES = 5;
const TOP_SOCIAL_NETWORKS = 12;
const TOP_SOCIAL_PAGES = 5;

const searchTotals = (row: data.SearchTotalsRow): SearchTotals => ({
  clicks: row.clicks,
  impressions: row.impressions,
  ctr: ctr(row.clicks, row.impressions),
  position: averagePosition(row.positionSum, row.impressions),
});

const syncInfo = (row: integrations.SeoIntegration | undefined): SeoSyncInfo | null =>
  row ? { status: row.syncStatus, syncedThrough: row.syncedThrough, lastSyncAt: row.lastSyncAt, detail: row.syncDetail } : null;

async function loadSearch(db: Database, projectId: string, range: DateRange, prev: DateRange, filter?: marketsRepo.PageFilter): Promise<SeoDashboard["search"]> {
  const scope = (r: DateRange) => ({ from: r.from, to: r.to, pageFilter: filter });
  const [current, before, daily, pages, countries, devices] = await Promise.all([
    data.searchTotals(db, projectId, scope(range)),
    data.searchTotals(db, projectId, scope(prev)),
    data.searchDaily(db, projectId, scope(range)),
    data.searchBy(db, projectId, scope(range), "page", TOP_PAGES),
    data.searchBy(db, projectId, scope(range), "country", TOP_COUNTRIES),
    data.searchBy(db, projectId, scope(range), "device", 3),
  ]);
  if (current.rows === 0) return null;
  return {
    range,
    previous: prev,
    totals: searchTotals(current),
    previousTotals: searchTotals(before),
    daily: fillDays(range, daily, (date) => ({ date, clicks: 0, impressions: 0 })),
    topPages: pages.map((p) => ({ page: p.key, clicks: p.clicks, impressions: p.impressions, ctr: ctr(p.clicks, p.impressions), position: averagePosition(p.positionSum, p.impressions) })),
    countries: countries.map((c) => ({ country: c.key, name: countryName(c.key), clicks: c.clicks, impressions: c.impressions })),
    devices: devices.map((d) => ({ device: d.key, label: deviceLabel(d.key), clicks: d.clicks, impressions: d.impressions })),
  };
}

async function loadTraffic(db: Database, projectId: string, range: DateRange, prev: DateRange, filter?: marketsRepo.PageFilter): Promise<SeoDashboard["traffic"]> {
  const scope = (r: DateRange) => ({ from: r.from, to: r.to, pageFilter: filter });
  const [current, before, daily, channels, pages, countries] = await Promise.all([
    data.trafficTotals(db, projectId, scope(range)),
    data.trafficTotals(db, projectId, scope(prev)),
    data.trafficDaily(db, projectId, scope(range)),
    data.trafficBy(db, projectId, scope(range), "channel", TOP_CHANNELS),
    data.trafficBy(db, projectId, scope(range), "page", TOP_PAGES),
    data.trafficBy(db, projectId, scope(range), "country", TOP_COUNTRIES),
  ]);
  if (current.rows === 0) return null;
  return {
    range,
    previous: prev,
    totals: { sessions: current.sessions, users: current.users },
    previousTotals: { sessions: before.sessions, users: before.users },
    daily: fillDays(range, daily, (date) => ({ date, sessions: 0 })),
    channels: channels.map((c) => ({ channel: c.key, sessions: c.sessions })),
    topPages: pages.map((p) => ({ page: p.key, sessions: p.sessions, users: p.users })),
    countries: countries.map((c) => ({ country: ga4CountryName(c.key), sessions: c.sessions })),
  };
}

async function loadSocial(db: Database, projectId: string, range: DateRange, prev: DateRange, filter?: marketsRepo.PageFilter): Promise<SeoDashboard["social"]> {
  const scope = (r: DateRange) => ({ from: r.from, to: r.to, pageFilter: filter });
  const [current, before, networks, pages] = await Promise.all([
    data.socialTotals(db, projectId, scope(range)),
    data.socialTotals(db, projectId, scope(prev)),
    data.socialBy(db, projectId, scope(range), "network", TOP_SOCIAL_NETWORKS),
    data.socialBy(db, projectId, scope(range), "page", TOP_SOCIAL_PAGES),
  ]);
  if (current.rows === 0) return null;
  return {
    range,
    previous: prev,
    totals: { sessions: current.sessions, users: current.users },
    previousTotals: { sessions: before.sessions, users: before.users },
    byNetwork: networks.map((n) => ({ network: n.key, label: socialLabel(n.key), sessions: n.sessions })),
    topPages: pages.map((p) => ({ page: p.key, sessions: p.sessions })),
  };
}

async function loadAi(db: Database, projectId: string, range: DateRange, prev: DateRange, filter?: marketsRepo.PageFilter): Promise<SeoDashboard["ai"]> {
  const scope = (r: DateRange) => ({ from: r.from, to: r.to, pageFilter: filter });
  const [current, before, sources, pages] = await Promise.all([
    data.aiTotals(db, projectId, scope(range)),
    data.aiTotals(db, projectId, scope(prev)),
    data.aiBy(db, projectId, scope(range), "source", TOP_AI_SOURCES),
    data.aiBy(db, projectId, scope(range), "page", TOP_AI_PAGES),
  ]);
  if (current.rows === 0) return null;
  return {
    range,
    previous: prev,
    totals: { sessions: current.sessions, users: current.users },
    previousTotals: { sessions: before.sessions, users: before.users },
    bySource: sources.map((s) => ({ source: s.key, sessions: s.sessions })),
    topPages: pages.map((p) => ({ page: p.key, sessions: p.sessions })),
  };
}

async function loadLanguages(db: Database, projectId: string, s: DateRange, t: DateRange, markets: Market[]): Promise<NonNullable<SeoDashboard["languages"]>> {
  const [search, traffic] = await Promise.all([data.searchByLanguage(db, projectId, s, markets), data.trafficByLanguage(db, projectId, t, markets)]);
  const rows = new Map(markets.map((m) => [m.lang, { lang: m.lang, label: langLabel(m.lang), isDefault: m.prefix === ROOT, clicks: 0, impressions: 0, sessions: 0 }]));
  for (const r of search) {
    const row = rows.get(r.lang) ?? { lang: r.lang, label: langLabel(r.lang), isDefault: false, clicks: 0, impressions: 0, sessions: 0 };
    row.clicks += r.clicks;
    row.impressions += r.impressions;
    rows.set(r.lang, row);
  }
  for (const r of traffic) {
    const row = rows.get(r.lang) ?? { lang: r.lang, label: langLabel(r.lang), isDefault: false, clicks: 0, impressions: 0, sessions: 0 };
    row.sessions += r.sessions;
    rows.set(r.lang, row);
  }
  // «Sin idioma» solo aparece si de verdad hay páginas que no encajan en ningún prefijo.
  const list = [...rows.values()].filter((r) => r.lang !== NO_LANG || r.clicks + r.sessions > 0);
  return list.sort((a, b) => b.clicks + b.sessions - (a.clicks + a.sessions) || a.label.localeCompare(b.label, "es"));
}

/**
 * Todo lo que muestra la sección «Tráfico y búsqueda» de un proyecto: totales del periodo y del anterior, series
 * diarias, rankings y estado de la última descarga. El periodo termina en el último día con datos, no en «hoy».
 */
export async function getSeoDashboard(projectId: string, opts: { days: number; /** Código de idioma (`?idioma=`); lo que no sirva se ignora. */ lang?: string }, db: Database = getDb()): Promise<SeoDashboard> {
  assertUuid(projectId, "Proyecto");
  if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 366) throw new DomainError("INVALID", "El periodo debe ser de 1 a 366 días.");
  const [rows, last, declared] = await Promise.all([integrations.listForProject(db, projectId), data.lastDates(db, projectId), marketsRepo.listMarkets(db, projectId)]);
  // Para mostrar: el idioma por defecto primero y luego por nombre (igual que getMarkets).
  const markets = declared
    .map((m) => ({ lang: m.lang, prefix: m.prefix, isDefault: m.prefix === ROOT, label: langLabel(m.lang) }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label, "es"));
  const lang = parseLangParam(opts.lang, declared) ?? null;
  const filter = lang ? marketsRepo.languageFilter(declared, lang) : undefined;
  const sync = { gsc: syncInfo(rows.find((r) => r.kind === "gsc")), ga4: syncInfo(rows.find((r) => r.kind === "ga4")) };

  const end = latestDate([last.search, last.traffic, last.ai, last.social]);
  if (!end) return { range: null, previous: null, sync, markets, lang, languages: null, search: null, traffic: null, social: null, ai: null };

  const range = periodRange(end, opts.days);
  const prev = previousRange(range);
  // Cada fuente termina en su último día con datos: con un solo final, los últimos días de Search Console (que cierra ~3
  // días tarde) saldrían como ceros y la comparación con el periodo anterior contaría menos días que él.
  const forSource = (lastDay: string | null) => {
    const r = periodRange(lastDay ?? end, opts.days);
    return { r, p: previousRange(r) };
  };
  const s = forSource(last.search);
  const t = forSource(latestDate([last.traffic, last.ai, last.social]));
  const [search, traffic, social, ai, languages] = await Promise.all([
    loadSearch(db, projectId, s.r, s.p, filter),
    loadTraffic(db, projectId, t.r, t.p, filter),
    loadSocial(db, projectId, t.r, t.p, filter),
    loadAi(db, projectId, t.r, t.p, filter),
    declared.length > 0 ? loadLanguages(db, projectId, s.r, t.r, declared) : Promise.resolve(null),
  ]);
  return { range, previous: { from: prev.from, to: prev.to }, sync, markets, lang, languages, search, traffic, social, ai };
}
