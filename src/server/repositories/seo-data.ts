import { and, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db/client";
import { seoAiReferralsDaily, seoQueryDaily, seoSearchDaily, seoSourceDaily, seoTrafficDaily } from "@/server/db/schema";
import type { Market } from "@/server/domain/seo-markets";
import { languageCase, type PageFilter } from "./seo-markets";

/**
 * Lecturas agregadas de los datos diarios de búsqueda y tráfico. Todo se agrega en SQL (`group by`, `sum`): nunca se
 * traen filas sin agregar. Las sumas se convierten a `double precision` para que lleguen como número y no como texto.
 */

/** Periodo y, opcionalmente, un filtro de página (para quedarse con un solo idioma). */
type Range = { from: string; to: string; pageFilter?: PageFilter };

const num = (column: PgColumn | SQL) => sql<number>`coalesce(sum(${column}), 0)::double precision`;
/** Día como texto «AAAA-MM-DD», sin depender de cómo el controlador convierta las fechas. */
const dayText = (column: PgColumn) => sql<string>`to_char(${column}, 'YYYY-MM-DD')`;
const count = sql<number>`count(*)::int`;

// ----------------------------------------------------------- último día

/** Último día con datos en cada tabla (null si la tabla no tiene filas del proyecto). */
export async function lastDates(db: Database, projectId: string): Promise<{ search: string | null; traffic: string | null; ai: string | null; sources: string | null }> {
  const [search, traffic, ai, sources] = await Promise.all([
    db.select({ d: sql<string | null>`to_char(max(${seoSearchDaily.date}), 'YYYY-MM-DD')` }).from(seoSearchDaily).where(eq(seoSearchDaily.projectId, projectId)),
    db.select({ d: sql<string | null>`to_char(max(${seoTrafficDaily.date}), 'YYYY-MM-DD')` }).from(seoTrafficDaily).where(eq(seoTrafficDaily.projectId, projectId)),
    db.select({ d: sql<string | null>`to_char(max(${seoAiReferralsDaily.date}), 'YYYY-MM-DD')` }).from(seoAiReferralsDaily).where(eq(seoAiReferralsDaily.projectId, projectId)),
    db.select({ d: sql<string | null>`to_char(max(${seoSourceDaily.date}), 'YYYY-MM-DD')` }).from(seoSourceDaily).where(eq(seoSourceDaily.projectId, projectId)),
  ]);
  return { search: search[0]?.d ?? null, traffic: traffic[0]?.d ?? null, ai: ai[0]?.d ?? null, sources: sources[0]?.d ?? null };
}

// ------------------------------------------------------- Search Console

export type SearchTotalsRow = { rows: number; clicks: number; impressions: number; positionSum: number };

const searchIn = (projectId: string, r: Range) => and(eq(seoSearchDaily.projectId, projectId), between(seoSearchDaily.date, r.from, r.to), r.pageFilter?.(seoSearchDaily.page));

export async function searchTotals(db: Database, projectId: string, r: Range): Promise<SearchTotalsRow> {
  const [row] = await db
    .select({ rows: count, clicks: num(seoSearchDaily.clicks), impressions: num(seoSearchDaily.impressions), positionSum: num(seoSearchDaily.positionSum) })
    .from(seoSearchDaily)
    .where(searchIn(projectId, r));
  return row ?? { rows: 0, clicks: 0, impressions: 0, positionSum: 0 };
}

export async function searchDaily(db: Database, projectId: string, r: Range): Promise<Array<{ date: string; clicks: number; impressions: number }>> {
  const date = dayText(seoSearchDaily.date);
  return db
    .select({ date, clicks: num(seoSearchDaily.clicks), impressions: num(seoSearchDaily.impressions) })
    .from(seoSearchDaily)
    .where(searchIn(projectId, r))
    .groupBy(date)
    .orderBy(date);
}

export type SearchGroupRow = { key: string; clicks: number; impressions: number; positionSum: number };

/** Clics, impresiones y suma de posición por página, país o dispositivo, de más a menos clics (desempate: impresiones, clave). */
export async function searchBy(db: Database, projectId: string, r: Range, by: "page" | "country" | "device", limit: number): Promise<SearchGroupRow[]> {
  const column = seoSearchDaily[by];
  const clicks = num(seoSearchDaily.clicks);
  const impressions = num(seoSearchDaily.impressions);
  return db
    .select({ key: column, clicks, impressions, positionSum: num(seoSearchDaily.positionSum) })
    .from(seoSearchDaily)
    .where(searchIn(projectId, r))
    .groupBy(column)
    .orderBy(desc(clicks), desc(impressions), column)
    .limit(limit);
}

// ------------------------------------------------------------------ GA4

export type TrafficTotalsRow = { rows: number; sessions: number; users: number };

const trafficIn = (projectId: string, r: Range) => and(eq(seoTrafficDaily.projectId, projectId), between(seoTrafficDaily.date, r.from, r.to), r.pageFilter?.(seoTrafficDaily.page));

export async function trafficTotals(db: Database, projectId: string, r: Range): Promise<TrafficTotalsRow> {
  const [row] = await db
    .select({ rows: count, sessions: num(seoTrafficDaily.sessions), users: num(seoTrafficDaily.users) })
    .from(seoTrafficDaily)
    .where(trafficIn(projectId, r));
  return row ?? { rows: 0, sessions: 0, users: 0 };
}

export async function trafficDaily(db: Database, projectId: string, r: Range): Promise<Array<{ date: string; sessions: number }>> {
  const date = dayText(seoTrafficDaily.date);
  return db.select({ date, sessions: num(seoTrafficDaily.sessions) }).from(seoTrafficDaily).where(trafficIn(projectId, r)).groupBy(date).orderBy(date);
}

/** Sesiones y usuarios por página, país o canal, de más a menos sesiones. */
export async function trafficBy(db: Database, projectId: string, r: Range, by: "page" | "country" | "channel", limit: number): Promise<Array<{ key: string; sessions: number; users: number }>> {
  const column = seoTrafficDaily[by];
  const sessions = num(seoTrafficDaily.sessions);
  return db
    .select({ key: column, sessions, users: num(seoTrafficDaily.users) })
    .from(seoTrafficDaily)
    .where(trafficIn(projectId, r))
    .groupBy(column)
    .orderBy(desc(sessions), column)
    .limit(limit);
}

// ------------------------------------------------------- visitas desde IA

const aiIn = (projectId: string, r: Range) => and(eq(seoAiReferralsDaily.projectId, projectId), between(seoAiReferralsDaily.date, r.from, r.to), r.pageFilter?.(seoAiReferralsDaily.page));

export async function aiTotals(db: Database, projectId: string, r: Range): Promise<TrafficTotalsRow> {
  const [row] = await db
    .select({ rows: count, sessions: num(seoAiReferralsDaily.sessions), users: num(seoAiReferralsDaily.users) })
    .from(seoAiReferralsDaily)
    .where(aiIn(projectId, r));
  return row ?? { rows: 0, sessions: 0, users: 0 };
}

export async function aiBy(db: Database, projectId: string, r: Range, by: "source" | "page", limit: number): Promise<Array<{ key: string; sessions: number; users: number }>> {
  const column = seoAiReferralsDaily[by];
  const sessions = num(seoAiReferralsDaily.sessions);
  return db
    .select({ key: column, sessions, users: num(seoAiReferralsDaily.users) })
    .from(seoAiReferralsDaily)
    .where(aiIn(projectId, r))
    .groupBy(column)
    .orderBy(desc(sessions), column)
    .limit(limit);
}

// ----------------------------------------------- de dónde llegan (reparto completo)

const sourceIn = (projectId: string, r: Range, group?: string) =>
  and(eq(seoSourceDaily.projectId, projectId), between(seoSourceDaily.date, r.from, r.to), group ? eq(seoSourceDaily.grp, group) : undefined, r.pageFilter?.(seoSourceDaily.page));

export async function sourceTotals(db: Database, projectId: string, r: Range, group?: string): Promise<TrafficTotalsRow> {
  const [row] = await db
    .select({ rows: count, sessions: num(seoSourceDaily.sessions), users: num(seoSourceDaily.users) })
    .from(seoSourceDaily)
    .where(sourceIn(projectId, r, group));
  return row ?? { rows: 0, sessions: 0, users: 0 };
}

/** Sesiones por grupo (buscador, red social, directo…) en el periodo. */
export async function sourceByGroup(db: Database, projectId: string, r: Range): Promise<Array<{ group: string; sessions: number }>> {
  const sessions = num(seoSourceDaily.sessions);
  const rows = await db.select({ group: seoSourceDaily.grp, sessions }).from(seoSourceDaily).where(sourceIn(projectId, r)).groupBy(seoSourceDaily.grp).orderBy(desc(sessions), seoSourceDaily.grp);
  return rows;
}

/** Las fuentes concretas con más sesiones (de un grupo o de todos). */
export async function sourceTop(db: Database, projectId: string, r: Range, limit: number, group?: string): Promise<Array<{ group: string; key: string; sessions: number; users: number }>> {
  const sessions = num(seoSourceDaily.sessions);
  return db
    .select({ group: seoSourceDaily.grp, key: seoSourceDaily.source, sessions, users: num(seoSourceDaily.users) })
    .from(seoSourceDaily)
    .where(sourceIn(projectId, r, group))
    .groupBy(seoSourceDaily.grp, seoSourceDaily.source)
    .orderBy(desc(sessions), seoSourceDaily.grp, seoSourceDaily.source)
    .limit(limit);
}

/** Páginas de entrada de un grupo (p. ej. a las que llegan desde las redes). */
export async function sourcePages(db: Database, projectId: string, r: Range, limit: number, group?: string): Promise<Array<{ key: string; sessions: number; users: number }>> {
  const sessions = num(seoSourceDaily.sessions);
  return db
    .select({ key: seoSourceDaily.page, sessions, users: num(seoSourceDaily.users) })
    .from(seoSourceDaily)
    .where(sourceIn(projectId, r, group))
    .groupBy(seoSourceDaily.page)
    .orderBy(desc(sessions), seoSourceDaily.page)
    .limit(limit);
}

// Redes sociales: el grupo «social» del reparto (los nombres se conservan para quien ya los usa).
export const socialTotals = (db: Database, projectId: string, r: Range) => sourceTotals(db, projectId, r, "social");
export async function socialBy(db: Database, projectId: string, r: Range, by: "network" | "page", limit: number): Promise<Array<{ key: string; sessions: number; users: number }>> {
  if (by === "page") return sourcePages(db, projectId, r, limit, "social");
  return (await sourceTop(db, projectId, r, limit, "social")).map(({ key, sessions, users }) => ({ key, sessions, users }));
}

// ------------------------------------------------------- con qué buscan (Search Console)

export type QueryRowOut = { query: string; clicks: number; impressions: number; positionSum: number };

/** Las consultas con más clics del periodo (suma de los días; la posición, ponderada por impresiones). No admite filtro de idioma: no hay página. */
export async function queryTop(db: Database, projectId: string, r: { from: string; to: string }, limit: number): Promise<QueryRowOut[]> {
  const clicks = num(seoQueryDaily.clicks);
  const rows = await db
    .select({ query: seoQueryDaily.query, clicks, impressions: num(seoQueryDaily.impressions), positionSum: sql<number>`coalesce(sum(${seoQueryDaily.positionSum}), 0)::float` })
    .from(seoQueryDaily)
    .where(and(eq(seoQueryDaily.projectId, projectId), between(seoQueryDaily.date, r.from, r.to)))
    .groupBy(seoQueryDaily.query)
    .orderBy(desc(clicks), seoQueryDaily.query)
    .limit(limit);
  return rows.map((x) => ({ ...x, positionSum: Number(x.positionSum) }));
}

// ------------------------------------------------------ desglose por idioma

/** Clics e impresiones de Search Console por idioma (según el prefijo de la ruta). Ignora cualquier filtro de idioma. */
export async function searchByLanguage(db: Database, projectId: string, r: { from: string; to: string }, markets: Market[]): Promise<Array<{ lang: string; clicks: number; impressions: number }>> {
  const lang = languageCase(markets, seoSearchDaily.page);
  return db
    .select({ lang, clicks: num(seoSearchDaily.clicks), impressions: num(seoSearchDaily.impressions) })
    .from(seoSearchDaily)
    .where(searchIn(projectId, r))
    .groupBy(sql`1`);
}

/** Sesiones de GA4 por idioma (según el prefijo de la ruta). */
export async function trafficByLanguage(db: Database, projectId: string, r: { from: string; to: string }, markets: Market[]): Promise<Array<{ lang: string; sessions: number }>> {
  const lang = languageCase(markets, seoTrafficDaily.page);
  return db
    .select({ lang, sessions: num(seoTrafficDaily.sessions) })
    .from(seoTrafficDaily)
    .where(trafficIn(projectId, r))
    .groupBy(sql`1`);
}

// ------------------------------------------------------------ la flota

/** Sesiones de cada proyecto en dos periodos (el actual y el anterior), en una sola consulta para toda la flota. */
export async function fleetSessions(db: Database, projectIds: string[], cur: { from: string; to: string }, prev: { from: string; to: string }): Promise<Array<{ projectId: string; current: number; previous: number; rows: number }>> {
  if (projectIds.length === 0) return [];
  const inCur = sql`${seoTrafficDaily.date} between ${cur.from} and ${cur.to}`;
  const inPrev = sql`${seoTrafficDaily.date} between ${prev.from} and ${prev.to}`;
  return db
    .select({
      projectId: seoTrafficDaily.projectId,
      current: sql<number>`coalesce(sum(case when ${inCur} then ${seoTrafficDaily.sessions} else 0 end), 0)::double precision`,
      previous: sql<number>`coalesce(sum(case when ${inPrev} then ${seoTrafficDaily.sessions} else 0 end), 0)::double precision`,
      rows: sql<number>`count(*) filter (where ${inCur})::int`,
    })
    .from(seoTrafficDaily)
    .where(and(inArray(seoTrafficDaily.projectId, projectIds), between(seoTrafficDaily.date, prev.from, cur.to)))
    .groupBy(seoTrafficDaily.projectId);
}

/** La fuente con más sesiones de cada proyecto en el periodo (sin contar «directo»), en una sola consulta. */
export async function fleetTopSources(db: Database, projectIds: string[], r: { from: string; to: string }): Promise<Array<{ projectId: string; group: string; key: string; sessions: number }>> {
  if (projectIds.length === 0) return [];
  const sessions = num(seoSourceDaily.sessions);
  const rows = await db
    .select({ projectId: seoSourceDaily.projectId, group: seoSourceDaily.grp, key: seoSourceDaily.source, sessions })
    .from(seoSourceDaily)
    .where(and(inArray(seoSourceDaily.projectId, projectIds), between(seoSourceDaily.date, r.from, r.to), sql`${seoSourceDaily.grp} <> 'direct'`))
    .groupBy(seoSourceDaily.projectId, seoSourceDaily.grp, seoSourceDaily.source);
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const cur = best.get(row.projectId);
    if (!cur || row.sessions > cur.sessions) best.set(row.projectId, row);
  }
  return [...best.values()];
}
