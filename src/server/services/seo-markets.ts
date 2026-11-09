import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { langLabel, languageSegment, marketConflict, normalizeLang, normalizePrefix, ROOT, type Market } from "@/server/domain/seo-markets";
import { findProject } from "@/server/repositories/projects";
import * as repo from "@/server/repositories/seo-markets";
import { assertUuid, isUniqueViolation } from "./shared";

export type SeoMarket = { lang: string; prefix: string; isDefault: boolean; label: string };

const toMarket = (m: Market): SeoMarket => ({ lang: m.lang, prefix: m.prefix, isDefault: m.prefix === ROOT, label: langLabel(m.lang) });

/** Idiomas declarados de un proyecto: el idioma por defecto primero y luego por nombre. */
export async function getMarkets(projectId: string, db: Database = getDb()): Promise<SeoMarket[]> {
  assertUuid(projectId, "Proyecto");
  return (await repo.listMarkets(db, projectId)).map(toMarket).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label, "es"));
}

/**
 * Declara un idioma del sitio. `isDefault` marca el que no lleva prefijo (por ejemplo, el español de la portada `/`);
 * en ese caso el prefijo se ignora.
 */
export async function addMarket(projectId: string, input: { lang: string; prefix: string; isDefault: boolean }, db: Database = getDb()): Promise<SeoMarket> {
  assertUuid(projectId, "Proyecto");
  if (!(await findProject(db, projectId))) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const market: Market = { lang: normalizeLang(input.lang), prefix: input.isDefault ? ROOT : normalizePrefix(input.prefix) };
  if (!input.isDefault && market.prefix === ROOT) throw new DomainError("INVALID", "Indica el prefijo (por ejemplo /es) o marca «idioma por defecto» si no lleva prefijo.");
  const conflict = marketConflict(await repo.listMarkets(db, projectId), market);
  if (conflict) throw new DomainError("CONFLICT", conflict);
  try {
    await repo.insertMarket(db, projectId, market);
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("CONFLICT", "Ese idioma o prefijo ya está declarado.");
    throw err;
  }
  return toMarket(market);
}

export async function removeMarket(projectId: string, lang: string, db: Database = getDb()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  if ((await repo.deleteMarket(db, projectId, lang)) === 0) throw new DomainError("NOT_FOUND", "Ese idioma no está declarado.");
}

export type MarketSuggestion = { prefix: string; lang: string; label: string; clicks: number; sessions: number };

/** Idiomas que parecen existir según las rutas de los datos descargados y que todavía no están declarados. */
export async function getMarketSuggestions(projectId: string, db: Database = getDb()): Promise<MarketSuggestion[]> {
  assertUuid(projectId, "Proyecto");
  const [segments, declared] = await Promise.all([repo.languageSegments(db, projectId), repo.listMarkets(db, projectId)]);
  const out: MarketSuggestion[] = [];
  for (const s of segments) {
    const prefix = languageSegment(s.segment);
    if (!prefix) continue;
    const lang = prefix.slice(1).split("-")[0]!;
    if (declared.some((m) => m.prefix === prefix || m.lang === lang) || out.some((o) => o.lang === lang)) continue;
    out.push({ prefix, lang, label: langLabel(lang), clicks: Math.round(s.clicks), sessions: Math.round(s.sessions) });
    if (out.length === 6) break;
  }
  return out;
}
