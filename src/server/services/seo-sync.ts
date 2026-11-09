import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { readHeartbeat } from "@/server/queue/heartbeat";
import { getRedis } from "@/server/queue/connection";
import { seoQueue } from "@/server/queue/queues";
import { SEO_SYNC_JOB } from "@/server/queue/schedulers";
import * as repo from "@/server/repositories/seo-integrations";
import { assertUuid } from "./shared";

const ENQUEUE_TIMEOUT_MS = 8_000;

/**
 * Pide al worker descargar ahora los datos de Search Console y GA4 de un proyecto. Si ya hay una petición esperando
 * o en curso, no encola otra. Exige que el proyecto tenga alguna de las dos conexiones y un worker en línea.
 */
export async function requestSeoSync(projectId: string, deps: { db?: Database; queue?: Queue; redis?: Redis } = {}): Promise<{ queued: boolean }> {
  assertUuid(projectId, "Proyecto");
  const db = deps.db ?? getDb();
  const connected = (await repo.listForProject(db, projectId)).some((i) => i.kind === "gsc" || i.kind === "ga4");
  if (!connected) throw new DomainError("INVALID", "Conecta Search Console o GA4 antes de actualizar los datos.");

  const redis = deps.redis ?? getRedis();
  if (!(await readHeartbeat(redis))) {
    throw new DomainError("UPSTREAM", "El worker no está en línea. Inicia el servicio worker e inténtalo de nuevo.");
  }

  const queue = deps.queue ?? seoQueue(redis);
  const jobId = `seo-sync-manual-${projectId}`;
  // Con Redis caído las órdenes de BullMQ se quedan esperando para siempre: mejor avisar que dejar el botón colgado.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DomainError("UPSTREAM", "No se pudo pedir la actualización (Redis no responde). Inténtalo de nuevo.")), ENQUEUE_TIMEOUT_MS);
  });
  const enqueue = async (): Promise<{ queued: boolean }> => {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") return { queued: false };
      await existing.remove().catch(() => undefined);
    }
    await queue.add(SEO_SYNC_JOB, { projectId }, { jobId, removeOnComplete: true, removeOnFail: true });
    return { queued: true };
  };
  try {
    return await Promise.race([enqueue(), deadline]);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("UPSTREAM", "No se pudo pedir la actualización (Redis no responde). Inténtalo de nuevo.");
  } finally {
    clearTimeout(timer);
  }
}
