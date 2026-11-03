import type { Queue } from "bullmq";
import { getDb, type Database } from "@/server/db/client";
import { buildBackup } from "@/server/backup/export";
import { BACKUP_PREFIX, STALE_AFTER_HOURS, isBackupKey, selectBackupsToPrune, type BackupObject } from "@/server/backup/retention";
import { maintenanceQueue } from "@/server/queue/queues";
import { BACKUP_JOB } from "@/server/queue/schedulers";
import { deleteSetting, getSetting, setSetting } from "@/server/repositories/settings";
import { getR2, type R2Store } from "@/server/storage/r2";

export type LastBackup = { at: string; key: string; bytes: number; rows: number };
export type LastBackupError = { at: string; message: string };

const LAST_KEY = "last_backup";
const ERROR_KEY = "last_backup_error";

type Store = Pick<R2Store, "putObject" | "listObjects" | "deleteObjects">;

export type BackupSummary = LastBackup & { pruned: number };

/** Texto corto y sin datos sensibles del motivo de un fallo. */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 200);

/**
 * Hace un respaldo completo, lo sube a R2, lo registra y aplica la retención. Un fallo se anota para que
 * el panel lo muestre y se relanza para que el llamador pueda avisar.
 */
export async function runBackup(
  deps: { db?: Database; r2?: Store; now?: () => Date; keepDays?: number; keepMin?: number } = {},
): Promise<BackupSummary> {
  const db = deps.db ?? getDb();
  const r2 = deps.r2 ?? getR2();
  const now = (deps.now ?? (() => new Date()))();
  try {
    const { body, key, counts } = await buildBackup(db, now);
    await r2.putObject(key, body, "application/gzip");
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    const last: LastBackup = { at: now.toISOString(), key, bytes: body.byteLength, rows };
    await setSetting(db, LAST_KEY, last);
    await deleteSetting(db, ERROR_KEY);

    let pruned = 0;
    try {
      const old = selectBackupsToPrune(await r2.listObjects(BACKUP_PREFIX), now, { keepDays: deps.keepDays, keepMin: deps.keepMin });
      if (old.length > 0) await r2.deleteObjects(old);
      pruned = old.length;
    } catch {
      // No poder limpiar viejos no invalida el respaldo recién hecho.
    }
    return { ...last, pruned };
  } catch (err) {
    await setSetting(db, ERROR_KEY, { at: now.toISOString(), message: reason(err) } satisfies LastBackupError).catch(() => undefined);
    throw err;
  }
}

export type BackupStatus = {
  last: LastBackup | null;
  lastError: LastBackupError | null;
  /** Sin respaldo reciente: pasaron más de 36 horas o nunca se hizo uno. */
  stale: boolean;
  /** Respaldos presentes en R2, del más reciente al más antiguo; null si R2 no respondió. */
  recent: BackupObject[] | null;
};

export async function getBackupStatus(deps: { db?: Database; r2?: Pick<R2Store, "listObjects">; now?: () => Date } = {}): Promise<BackupStatus> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? (() => new Date()))();
  const [last, lastError] = await Promise.all([getSetting<LastBackup>(db, LAST_KEY), getSetting<LastBackupError>(db, ERROR_KEY)]);
  let recent: BackupObject[] | null = null;
  try {
    recent = (await (deps.r2 ?? getR2()).listObjects(BACKUP_PREFIX))
      .filter((o) => isBackupKey(o.key))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
      .slice(0, 8);
  } catch {
    recent = null;
  }
  const stale = !last || now.getTime() - new Date(last.at).getTime() > STALE_AFTER_HOURS * 3_600_000;
  return { last: last ?? null, lastError: lastError ?? null, stale, recent };
}

/** Pide al worker un respaldo ahora. Si ya hay uno esperando, no encola otro. */
export async function requestBackupNow(deps: { queue?: Queue } = {}): Promise<{ queued: boolean }> {
  const queue = deps.queue ?? maintenanceQueue();
  const existing = await queue.getJob("backup-manual");
  if (existing) {
    const state = await existing.getState();
    if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") return { queued: false };
    await existing.remove().catch(() => undefined);
  }
  await queue.add(BACKUP_JOB, {}, { jobId: "backup-manual", removeOnComplete: true, removeOnFail: true });
  return { queued: true };
}
