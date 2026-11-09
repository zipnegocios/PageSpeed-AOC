/** Fecha ISO `YYYY-MM-DD` en UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/**
 * Ventana de `days` días que termina `lagDays` antes de hoy. GSC publica con retraso, así que el último
 * día se deja fuera por defecto; medir ese retraso es una de las preguntas del piloto.
 */
export function dateRange(days: number, lagDays: number, now: Date = new Date()): { startDate: string; endDate: string } {
  const end = new Date(now.getTime() - lagDays * DAY_MS);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

/** Cada día entre dos fechas ISO, ambas incluidas. */
export function eachDay(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(startDate); t <= Date.parse(endDate); t += DAY_MS) days.push(isoDate(new Date(t)));
  return days;
}

/** Días entre una fecha ISO y hoy (UTC). */
export function daysAgo(date: string, now: Date = new Date()): number {
  return Math.round((Date.parse(isoDate(now)) - Date.parse(date)) / DAY_MS);
}
