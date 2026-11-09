import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db/client";
import { seoMarkets, seoSearchDaily, seoTrafficDaily } from "@/server/db/schema";
import { NO_LANG, orderMarkets, ROOT, type Market } from "@/server/domain/seo-markets";

export async function listMarkets(db: Database, projectId: string): Promise<Market[]> {
  const rows = await db.select({ lang: seoMarkets.lang, prefix: seoMarkets.prefix }).from(seoMarkets).where(eq(seoMarkets.projectId, projectId));
  return orderMarkets(rows);
}

export async function insertMarket(db: Database, projectId: string, market: Market): Promise<void> {
  await db.insert(seoMarkets).values({ projectId, ...market });
}

export async function deleteMarket(db: Database, projectId: string, lang: string): Promise<number> {
  const rows = await db.delete(seoMarkets).where(and(eq(seoMarkets.projectId, projectId), eq(seoMarkets.lang, lang))).returning({ lang: seoMarkets.lang });
  return rows.length;
}

// --------------------------------------------------------- SQL por idioma

/** Condición sobre la columna de página. Los prefijos solo tienen letras, números y guiones, así que `LIKE` no necesita escapes. */
export type PageFilter = (page: PgColumn) => SQL;

const under = (page: PgColumn, prefix: string) => sql`(lower(${page}) = ${prefix} OR lower(${page}) LIKE ${`${prefix}/%`})`;

/**
 * Condición que deja solo las páginas de un idioma: las que cuelgan de su prefijo, o, para el idioma por defecto (o «sin
 * idioma»), las que no cuelgan de ningún otro. Undefined si el idioma no existe en el proyecto.
 */
export function languageFilter(markets: Market[], lang: string): PageFilter | undefined {
  const ordered = orderMarkets(markets);
  const target = lang === NO_LANG ? null : ordered.find((m) => m.lang === lang);
  if (lang !== NO_LANG && !target) return undefined;
  if (target && target.prefix !== ROOT) return (page) => under(page, target.prefix);
  const others = ordered.filter((m) => m.prefix !== ROOT);
  if (others.length === 0) return () => sql`true`;
  return (page) => sql`NOT (${sql.join(others.map((m) => under(page, m.prefix)), sql` OR `)})`;
}

/** Expresión que da el idioma de cada fila según su página, para agrupar. */
export function languageCase(markets: Market[], page: PgColumn): SQL<string> {
  const ordered = orderMarkets(markets);
  const fallback = ordered.find((m) => m.prefix === ROOT)?.lang ?? NO_LANG;
  const others = ordered.filter((m) => m.prefix !== ROOT);
  if (others.length === 0) return sql<string>`${fallback}::text`;
  return sql<string>`(CASE ${sql.join(others.map((m) => sql`WHEN ${under(page, m.prefix)} THEN ${m.lang}`), sql` `)} ELSE ${fallback} END)::text`;
}

// ----------------------------------------------------------- detección

/**
 * Primeros segmentos de ruta que parecen prefijos de idioma (`/es`, `/en-au`) en los datos descargados, con los clics y
 * las sesiones que suman: sirven para sugerir los idiomas del sitio sin que haya que escribirlos.
 */
export async function languageSegments(db: Database, projectId: string): Promise<Array<{ segment: string; clicks: number; sessions: number }>> {
  // Solo códigos de 2 letras (es, en, pt…): con 3 letras salen falsos idiomas como /faq o /app.
  const pattern = "^/[a-z]{2}(-[a-z0-9]{2,4})?(/|$)";
  const seg = (col: PgColumn) => sql<string>`'/' || split_part(lower(${col}), '/', 2)`;
  const [search, traffic] = await Promise.all([
    db
      .select({ segment: seg(seoSearchDaily.page), n: sql<number>`coalesce(sum(${seoSearchDaily.clicks}), 0)::double precision` })
      .from(seoSearchDaily)
      .where(and(eq(seoSearchDaily.projectId, projectId), sql`${seoSearchDaily.page} ~* ${pattern}`))
      .groupBy(sql`1`),
    db
      .select({ segment: seg(seoTrafficDaily.page), n: sql<number>`coalesce(sum(${seoTrafficDaily.sessions}), 0)::double precision` })
      .from(seoTrafficDaily)
      .where(and(eq(seoTrafficDaily.projectId, projectId), sql`${seoTrafficDaily.page} ~* ${pattern}`))
      .groupBy(sql`1`),
  ]);
  const out = new Map<string, { segment: string; clicks: number; sessions: number }>();
  for (const r of search) out.set(r.segment, { segment: r.segment, clicks: r.n, sessions: 0 });
  for (const r of traffic) out.set(r.segment, { segment: r.segment, clicks: out.get(r.segment)?.clicks ?? 0, sessions: r.n });
  return [...out.values()].sort((a, b) => b.clicks + b.sessions - (a.clicks + a.sessions));
}
