import { and, between, desc, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db/client";
import { seoAiReferralsDaily, seoSearchDaily, seoTrafficDaily } from "@/server/db/schema";

/**
 * Lecturas agregadas de los datos diarios de búsqueda y tráfico. Todo se agrega en SQL (`group by`, `sum`): nunca se
 * traen filas sin agregar. Las sumas se convierten a `double precision` para que lleguen como número y no como texto.
 */

type Range = { from: string; to: string };

const num = (column: PgColumn | SQL) => sql<number>`coalesce(sum(${column}), 0)::double precision`;
/** Día como texto «AAAA-MM-DD», sin depender de cómo el controlador convierta las fechas. */
const dayText = (column: PgColumn) => sql<string>`to_char(${column}, 'YYYY-MM-DD')`;
const count = sql<number>`count(*)::int`;

// ----------------------------------------------------------- último día

/** Último día con datos en cada tabla (null si la tabla no tiene filas del proyecto). */
export async function lastDates(db: Database, projectId: string): Promise<{ search: string | null; traffic: string | null; ai: string | null }> {
  const [search, traffic, ai] = await Promise.all([
    db.select({ d: sql<string | null>`to_char(max(${seoSearchDaily.date}), 'YYYY-MM-DD')` }).from(seoSearchDaily).where(eq(seoSearchDaily.projectId, projectId)),
    db.select({ d: sql<string | null>`to_char(max(${seoTrafficDaily.date}), 'YYYY-MM-DD')` }).from(seoTrafficDaily).where(eq(seoTrafficDaily.projectId, projectId)),
    db.select({ d: sql<string | null>`to_char(max(${seoAiReferralsDaily.date}), 'YYYY-MM-DD')` }).from(seoAiReferralsDaily).where(eq(seoAiReferralsDaily.projectId, projectId)),
  ]);
  return { search: search[0]?.d ?? null, traffic: traffic[0]?.d ?? null, ai: ai[0]?.d ?? null };
}

// ------------------------------------------------------- Search Console

export type SearchTotalsRow = { rows: number; clicks: number; impressions: number; positionSum: number };

const searchIn = (projectId: string, r: Range) => and(eq(seoSearchDaily.projectId, projectId), between(seoSearchDaily.date, r.from, r.to));

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

const trafficIn = (projectId: string, r: Range) => and(eq(seoTrafficDaily.projectId, projectId), between(seoTrafficDaily.date, r.from, r.to));

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

const aiIn = (projectId: string, r: Range) => and(eq(seoAiReferralsDaily.projectId, projectId), between(seoAiReferralsDaily.date, r.from, r.to));

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
