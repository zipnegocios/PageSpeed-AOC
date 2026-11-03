import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getDb, type Database } from "@/server/db/client";
import { getRedis } from "@/server/queue/connection";
import { readHeartbeat } from "@/server/queue/heartbeat";
import { lighthouseQueue, maintenanceQueue } from "@/server/queue/queues";
import { listProjectSchedules } from "@/server/queue/schedulers";
import { listRecentFailures, type FailedAudit } from "@/server/repositories/audits";
import { listProductionProjectsInfo } from "@/server/repositories/projects";

export type QueueCounts = { waiting: number; active: number; delayed: number; failed: number; completed: number };

export type ScheduleRow = {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  frequency: "weekly" | "daily";
  /** null: el proyecto está en producción pero aún no tiene agendador (se corrige al reconciliar). */
  next: Date | null;
};

export type QueueStatus = {
  /** false si Redis no respondió: solo se muestran los datos de la base de datos. */
  redis: boolean;
  worker: { online: boolean; chrome: boolean | null; lastBeatAt: Date | null };
  counts: QueueCounts | null;
  schedules: ScheduleRow[];
  recentFailures: FailedAudit[];
};

export type QueueStatusDeps = { db?: Database; redis?: Redis; lighthouse?: Queue; maintenance?: Queue };

export async function getQueueStatus(deps: QueueStatusDeps = {}): Promise<QueueStatus> {
  const db = deps.db ?? getDb();
  const [recentFailures, production] = await Promise.all([listRecentFailures(db, 10), listProductionProjectsInfo(db)]);

  try {
    const redis = deps.redis ?? getRedis();
    const [beat, raw, scheduled] = await Promise.all([
      readHeartbeat(redis),
      (deps.lighthouse ?? lighthouseQueue(redis)).getJobCounts("waiting", "prioritized", "active", "delayed", "failed", "completed"),
      listProjectSchedules(deps.maintenance ?? maintenanceQueue(redis)),
    ]);
    const nextByProject = new Map(scheduled.map((s) => [s.projectId, s.next]));
    return {
      redis: true,
      worker: { online: beat !== null, chrome: beat ? beat.chrome : null, lastBeatAt: beat ? new Date(beat.at) : null },
      counts: {
        waiting: (raw.waiting ?? 0) + (raw.prioritized ?? 0),
        active: raw.active ?? 0,
        delayed: raw.delayed ?? 0,
        failed: raw.failed ?? 0,
        completed: raw.completed ?? 0,
      },
      schedules: production.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        clientId: p.clientId,
        clientName: p.clientName,
        frequency: p.auditFrequency,
        next: nextByProject.get(p.id) ?? null,
      })),
      recentFailures,
    };
  } catch {
    return {
      redis: false,
      worker: { online: false, chrome: null, lastBeatAt: null },
      counts: null,
      schedules: production.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        clientId: p.clientId,
        clientName: p.clientName,
        frequency: p.auditFrequency,
        next: null,
      })),
      recentFailures,
    };
  }
}
