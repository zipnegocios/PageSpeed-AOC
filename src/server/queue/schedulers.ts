import type { Queue } from "bullmq";
import { projectCron, projectIdFromScheduler, schedulerId, type Frequency } from "@/server/domain/schedule";

/** Nombre del trabajo que dispara cada agendador de proyecto (cola maintenance). */
export const PLAN_JOB = "plan-project-audit";
export type PlanJobData = { projectId: string };

/** Trabajo periódico que corrige desfases entre Postgres y Redis. */
export const RECONCILE_JOB = "reconcile";
export const RECONCILE_SCHEDULER_ID = "reconcile";
export const RECONCILE_EVERY_MS = 15 * 60 * 1000;

/** Barrido que envía los correos de alertas pendientes. */
export const NOTIFY_JOB = "notify";
export const NOTIFY_SCHEDULER_ID = "notify";
export const NOTIFY_EVERY_MS = 5 * 60 * 1000;

/** Respaldo diario de Postgres a R2, a una hora de poco tráfico (UTC). */
export const BACKUP_JOB = "backup";
export const BACKUP_SCHEDULER_ID = "backup";
export const BACKUP_CRON = "17 3 * * *";

/** Datos reales de usuarios (Chrome UX Report): una vez al día, cuando Google ya publicó los del día anterior. */
export const CRUX_JOB = "crux";
export const CRUX_SCHEDULER_ID = "crux";
export const CRUX_CRON = "47 4 * * *";

/** Descarga de Search Console y GA4 (cola seo): una vez al día, cuando Google ya cerró los datos de los días anteriores. */
export const SEO_SYNC_JOB = "seo-sync";
export const SEO_SYNC_SCHEDULER_ID = "seo-sync";
export const SEO_SYNC_CRON = "37 5 * * *";

/** Rastreo técnico de los sitios (cola seo): el agendador semanal solo encola; cada rastreo es un trabajo propio con su `runId`. */
export const SEO_CRAWL_JOB = "seo-crawl";
export const SEO_CRAWL_WEEKLY_JOB = "seo-crawl-weekly";
export const SEO_CRAWL_SCHEDULER_ID = "seo-crawl-weekly";
/** Domingos a las 04:23 UTC, antes de la descarga diaria de datos (05:37) y lejos del respaldo (03:17). */
export const SEO_CRAWL_CRON = "23 4 * * 0";
export const crawlJobId = (runId: string) => `seo-crawl-${runId}`;

export type ProjectSchedule = { projectId: string; pattern: string | null; next: Date | null };

/**
 * Registra (o actualiza) el agendador de un proyecto en producción. Si ya existe con el mismo
 * cron no se toca: volver a registrarlo reiniciaría su siguiente ejecución.
 */
export async function upsertProjectScheduler(
  queue: Queue,
  project: { id: string; auditFrequency: Frequency },
): Promise<"created" | "updated" | "unchanged"> {
  const id = schedulerId(project.id);
  const pattern = projectCron(project.id, project.auditFrequency);
  const existing = await queue.getJobScheduler(id);
  if (existing?.pattern === pattern) return "unchanged";
  await queue.upsertJobScheduler(
    id,
    { pattern, tz: "UTC" },
    {
      name: PLAN_JOB,
      data: { projectId: project.id } satisfies PlanJobData,
      opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
    },
  );
  return existing ? "updated" : "created";
}

export async function removeProjectScheduler(queue: Queue, projectId: string): Promise<boolean> {
  return queue.removeJobScheduler(schedulerId(projectId));
}

export async function listProjectSchedules(queue: Queue): Promise<ProjectSchedule[]> {
  const all = await queue.getJobSchedulers(0, -1, true);
  return all.flatMap((s) => {
    const projectId = projectIdFromScheduler(s.key ?? s.id);
    return projectId ? [{ projectId, pattern: s.pattern ?? null, next: s.next ? new Date(s.next) : null }] : [];
  });
}

export async function getProjectNextRun(queue: Queue, projectId: string): Promise<Date | null> {
  const s = await queue.getJobScheduler(schedulerId(projectId));
  return s?.next ? new Date(s.next) : null;
}

/**
 * Deja los agendadores de Redis iguales a lo que dice la base de datos: crea los que faltan,
 * corrige los que cambiaron de frecuencia y borra los de proyectos que ya no están en producción.
 * Redis es transitorio; Postgres es la fuente de verdad.
 */
export async function syncProjectSchedulers(
  queue: Queue,
  production: Array<{ id: string; auditFrequency: Frequency }>,
): Promise<{ created: number; updated: number; removed: number; unchanged: number }> {
  const report = { created: 0, updated: 0, removed: 0, unchanged: 0 };
  const wanted = new Set(production.map((p) => p.id));
  for (const project of production) {
    report[await upsertProjectScheduler(queue, project)]++;
  }
  for (const existing of await listProjectSchedules(queue)) {
    if (!wanted.has(existing.projectId)) {
      await removeProjectScheduler(queue, existing.projectId);
      report.removed++;
    }
  }
  return report;
}
