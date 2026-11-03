import { createHash } from "node:crypto";

export type Frequency = "weekly" | "daily";

/** Prefijo del identificador del agendador de cada proyecto en BullMQ. */
export const SCHEDULER_PREFIX = "project:";
export const schedulerId = (projectId: string) => `${SCHEDULER_PREFIX}${projectId}`;
export const projectIdFromScheduler = (id: string | null | undefined): string | null =>
  id && id.startsWith(SCHEDULER_PREFIX) ? id.slice(SCHEDULER_PREFIX.length) : null;

/**
 * Cron (UTC) de un proyecto: semanal = un día de la semana a una hora fija; diario = todos los
 * días a esa hora. Minuto, hora y día salen de un hash del id, así que cada proyecto cae en un
 * momento distinto sin que haya una ventana horaria fija, y el mismo proyecto siempre cae en el
 * mismo momento (reiniciar el worker o volver a registrar el agendador no lo mueve).
 */
export function projectCron(projectId: string, frequency: Frequency): string {
  const bytes = createHash("sha256").update(projectId).digest();
  const minute = bytes[0]! % 60;
  const hour = bytes[1]! % 24;
  const weekday = bytes[2]! % 7; // 0 = domingo
  return frequency === "daily" ? `${minute} ${hour} * * *` : `${minute} ${hour} * * ${weekday}`;
}
