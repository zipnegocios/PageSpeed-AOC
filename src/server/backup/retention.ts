/** Prefijo de los respaldos en R2. Distinto de las claves de auditorías (`cliente/proyecto/...`): los slugs no llevan `_`. */
export const BACKUP_PREFIX = "_backups/postgres/";

const pad = (n: number) => String(n).padStart(2, "0");

/** `_backups/postgres/2026/11/aoc-20261103T031700Z.ndjson.gz` */
export function backupKey(at: Date): string {
  const stamp = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
  return `${BACKUP_PREFIX}${at.getUTCFullYear()}/${pad(at.getUTCMonth() + 1)}/aoc-${stamp}.ndjson.gz`;
}

export const isBackupKey = (key: string) => key.startsWith(BACKUP_PREFIX) && key.endsWith(".ndjson.gz");

export type BackupObject = { key: string; size: number; lastModified: Date };

/**
 * Qué respaldos borrar: los de más de `keepDays` días, salvo que sean de los `keepMin` más recientes.
 * Así, aunque los respaldos dejen de generarse, nunca se borra el último respaldo bueno.
 */
export function selectBackupsToPrune(
  items: BackupObject[],
  now: Date,
  options: { keepDays?: number; keepMin?: number } = {},
): string[] {
  const keepDays = options.keepDays ?? 30;
  const keepMin = options.keepMin ?? 5;
  const cutoff = now.getTime() - keepDays * 86_400_000;
  return items
    .filter((o) => isBackupKey(o.key))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
    .slice(keepMin)
    .filter((o) => o.lastModified.getTime() < cutoff)
    .map((o) => o.key);
}

/** Pasadas estas horas sin un respaldo correcto, el panel avisa (el job es diario). */
export const STALE_AFTER_HOURS = 36;
