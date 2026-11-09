import type { Change } from "@/server/domain/history";
import { percentChange } from "@/server/domain/seo-data";

/** Formatos y variaciones de la sección «Tráfico y búsqueda». Todo en español; el texto siempre lleva el número. */

const count = new Intl.NumberFormat("es", { maximumFractionDigits: 0, useGrouping: "always" });
const oneDecimal = new Intl.NumberFormat("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dayShort = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
const dayMedium = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

export const formatCount = (n: number): string => count.format(n);
/** Fracción a porcentaje con un decimal: 0,032 -> «3,2 %». */
export const formatPercent = (fraction: number): string => `${oneDecimal.format(fraction * 100)} %`;
export const formatPosition = (position: number | null): string => (position === null ? "—" : oneDecimal.format(position));

/** «5 nov» */
export const formatDayShort = (day: string): string => dayShort.format(utc(day));
/** «5 nov 2026» */
export const formatDayMedium = (day: string): string => dayMedium.format(utc(day));
/** «5 de noviembre de 2026» */
export const formatDayLong = (day: string): string => dayLong.format(utc(day));

const SAME: Change = { diff: 0, direction: "same", verdict: "same", text: "sin cambio" };

/** Variación porcentual (subir es mejor). Null si el periodo anterior no tiene datos para comparar. */
export function percentDelta(current: number, previous: number): Change | null {
  const pct = percentChange(current, previous);
  if (pct === null) return null;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return SAME;
  return { diff: rounded, direction: rounded > 0 ? "up" : "down", verdict: rounded > 0 ? "better" : "worse", text: `${oneDecimal.format(Math.abs(rounded))} %` };
}

/** Diferencia de CTR en puntos porcentuales (subir es mejor). */
export function ctrDelta(current: number, previous: number): Change {
  const diff = Math.round((current - previous) * 1000) / 10;
  if (diff === 0) return SAME;
  return { diff, direction: diff > 0 ? "up" : "down", verdict: diff > 0 ? "better" : "worse", text: `${oneDecimal.format(Math.abs(diff))} ${Math.abs(diff) === 1 ? "punto" : "puntos"}` };
}

/** Diferencia de posición media. Bajar el número es MEJORAR (la página sube en los resultados). */
export function positionDelta(current: number | null, previous: number | null): Change | null {
  if (current === null || previous === null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return SAME;
  return { diff, direction: diff > 0 ? "up" : "down", verdict: diff < 0 ? "better" : "worse", text: `${oneDecimal.format(Math.abs(diff))} ${Math.abs(diff) === 1 ? "posición" : "posiciones"}` };
}
