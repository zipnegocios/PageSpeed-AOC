import pino from "pino";
import { Queue, type Job } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import fixture from "../fixtures/lhr-minimal.json";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import type { WorkerEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { projectCron, schedulerId } from "@/server/domain/schedule";
import { createRedis, QUEUE_PREFIX } from "@/server/queue/connection";
import { LIGHTHOUSE_QUEUE, MAINTENANCE_QUEUE, type AuditJobData } from "@/server/queue/queues";
import { BACKUP_JOB, BACKUP_SCHEDULER_ID, CRUX_JOB, CRUX_SCHEDULER_ID, NOTIFY_SCHEDULER_ID, PLAN_JOB, RECONCILE_SCHEDULER_ID, getProjectNextRun, listProjectSchedules, upsertProjectScheduler, type PlanJobData } from "@/server/queue/schedulers";
import { cancelScheduledAudits } from "@/server/services/audits";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { getQueueStatus } from "@/server/services/queue-status";
import { reconcile } from "@/worker/reconcile";
import { createPlanProjectProcessor } from "@/worker/processors/plan-project.processor";
import type { LighthouseRunner } from "@/worker/lighthouse/runner";
import { startWorker, type RunningWorker } from "@/worker/start";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const ready = Boolean(dbUrl && redisUrl);

async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("tiempo de espera agotado");
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe.skipIf(!ready)("agendado, plan-project-audit y reconciliación", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const redis = createRedis(redisUrl ?? "redis://localhost:6379");
  const opts = { connection: redis, prefix: QUEUE_PREFIX };
  const lighthouse = new Queue<AuditJobData>(LIGHTHOUSE_QUEUE, opts);
  const maintenance = new Queue(MAINTENANCE_QUEUE, opts);
  const deps = { maintenance, lighthouse };
  const log = pino({ level: "silent" });
  let s3: FakeS3;
  let worker: RunningWorker | undefined;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
    s3 = await startFakeS3();
  });
  afterAll(async () => {
    await Promise.all([lighthouse.close(), maintenance.close()]);
    await redis.quit();
    await pool.end();
    await s3.close();
  });
  beforeEach(async () => {
    await lighthouse.obliterate({ force: true });
    await maintenance.obliterate({ force: true });
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    s3.objects.clear();
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  /** Proyecto con rutas. `phase` development por defecto: sin tocar Redis salvo que se pida. */
  async function setup(opts: { phase?: "development" | "production"; frequency?: "weekly" | "daily"; paths?: string[] } = {}) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(
      client.id,
      { name: "Sitio", baseUrl: "http://127.0.0.1:18123", phase: opts.phase ?? "development", auditFrequency: opts.frequency ?? "weekly" },
      db,
      deps,
    );
    const created = [];
    for (const path of opts.paths ?? ["/"]) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }
  const audits = () => db.select().from(s.auditLogs);
  const fakeJob = (projectId: string) => ({ id: "t1", data: { projectId } }) as unknown as Job<PlanJobData>;

  // ------------------------------------------------------------ enlaces con el proyecto
  describe("cambios del proyecto y su agendador", () => {
    it("un proyecto que nace en producción queda agendado con su cron en UTC", async () => {
      const { project } = await setup({ phase: "production", frequency: "weekly" });
      const scheduler = await maintenance.getJobScheduler(schedulerId(project.id));
      expect(scheduler).toMatchObject({ pattern: projectCron(project.id, "weekly"), tz: "UTC", name: PLAN_JOB });
      expect(scheduler?.template?.data).toEqual({ projectId: project.id });
      const next = await getProjectNextRun(maintenance, project.id);
      expect(next!.getTime()).toBeGreaterThan(Date.now());
    });

    it("uno en desarrollo no se agenda", async () => {
      const { project } = await setup();
      expect(await maintenance.getJobScheduler(schedulerId(project.id))).toBeUndefined();
    });

    it("pasar a producción lo agenda; volver a desarrollo lo retira y cancela lo programado pendiente", async () => {
      const { project, routes: [r] } = await setup({ paths: ["/"] });
      await projects.setProjectPhase(project.id, "production", db, deps);
      expect(await maintenance.getJobScheduler(schedulerId(project.id))).toBeDefined();

      // Pendientes: una programada y una manual (esta debe sobrevivir), más una programada ya en curso.
      const base = { projectId: project.id, routeId: r!.id, phaseAtRun: "production" as const };
      const [scheduledQueued] = await db.insert(s.auditLogs).values({ ...base, profile: "mobile", trigger: "scheduled" }).returning();
      const [manualQueued] = await db.insert(s.auditLogs).values({ ...base, profile: "desktop", trigger: "manual" }).returning();
      await lighthouse.add("audit", { auditId: scheduledQueued!.id }, { jobId: scheduledQueued!.id });
      await lighthouse.add("audit", { auditId: manualQueued!.id }, { jobId: manualQueued!.id });

      const out = await projects.setProjectPhase(project.id, "development", db, deps);
      expect(out.scheduler).toEqual({ ok: true, cancelled: 1 });
      expect(await maintenance.getJobScheduler(schedulerId(project.id))).toBeUndefined();
      expect((await audits()).map((a) => a.id)).toEqual([manualQueued!.id]);
      expect(await lighthouse.getJob(scheduledQueued!.id)).toBeUndefined();
      expect(await lighthouse.getJob(manualQueued!.id)).toBeDefined();
    });

    it("cambiar la frecuencia mueve el cron; archivar el proyecto retira el agendador", async () => {
      const { project } = await setup({ phase: "production", frequency: "weekly" });
      const form = { name: "Sitio", baseUrl: "http://127.0.0.1:18123", auditFrequency: "daily", sitemapUrl: "", allowedHosts: "" };
      await projects.updateProject(project.id, form, db, deps);
      expect((await maintenance.getJobScheduler(schedulerId(project.id)))?.pattern).toBe(projectCron(project.id, "daily"));
      await projects.archiveProject(project.id, db, deps);
      expect(await maintenance.getJobScheduler(schedulerId(project.id))).toBeUndefined();
    });

    it("si Redis falla, el cambio del proyecto se guarda igualmente y se avisa", async () => {
      const { project } = await setup();
      const broken = { upsertJobScheduler: async () => { throw new Error("redis caído"); }, getJobScheduler: async () => undefined, removeJobScheduler: async () => { throw new Error("redis caído"); } } as unknown as Queue;
      const out = await projects.setProjectPhase(project.id, "production", db, { maintenance: broken, lighthouse });
      expect(out.scheduler.ok).toBe(false);
      expect(out.project.phase).toBe("production");
      expect((await projects.getProject(project.id, db)).phase).toBe("production");
    });

    it("cancelScheduledAudits no toca las auditorías en curso", async () => {
      const { project, routes: [r] } = await setup();
      await db.insert(s.auditLogs).values({ projectId: project.id, routeId: r!.id, profile: "mobile", trigger: "scheduled", phaseAtRun: "production", status: "running", startedAt: new Date() });
      expect(await cancelScheduledAudits(project.id, { db, queue: lighthouse })).toBe(0);
      expect(await audits()).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------- plan-project-audit
  describe("plan-project-audit", () => {
    const processor = () => createPlanProjectProcessor({ db, redis, lighthouse, maintenance, log });

    it("pide móvil y escritorio de cada ruta monitoreada, como programadas y sin exigir worker en línea", async () => {
      const { project, routes: rs } = await setup({ phase: "production", paths: ["/", "/a", "/b"] });
      await routes.setRouteMonitored(rs[2]!.id, false, db); // /b no entra
      await processor()(fakeJob(project.id));

      const rows = await audits();
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((a) => a.routeId))).toEqual(new Set([rs[0]!.id, rs[1]!.id]));
      expect(rows.every((a) => a.trigger === "scheduled" && a.requestedBy === "agendador" && a.phaseAtRun === "production" && a.status === "queued")).toBe(true);
      const job = await lighthouse.getJob(rows[0]!.id);
      expect(job?.opts.priority).toBe(10);
    });

    it("la frecuencia diaria usa prioridad 5", async () => {
      const { project } = await setup({ phase: "production", frequency: "daily" });
      await processor()(fakeJob(project.id));
      const [a] = await audits();
      expect((await lighthouse.getJob(a!.id))?.opts.priority).toBe(5);
    });

    it("es idempotente: un segundo disparo no duplica lo que sigue pendiente", async () => {
      const { project } = await setup({ phase: "production", paths: ["/", "/a"] });
      await processor()(fakeJob(project.id));
      await processor()(fakeJob(project.id));
      expect(await audits()).toHaveLength(4);
    });

    it("si el proyecto ya no está en producción, retira su agendador y no audita", async () => {
      const { project } = await setup({ phase: "production" });
      await db.update(s.projects).set({ phase: "development" }).where(eq(s.projects.id, project.id));
      await processor()(fakeJob(project.id));
      expect(await audits()).toHaveLength(0);
      expect(await maintenance.getJobScheduler(schedulerId(project.id))).toBeUndefined();
    });

    it("una ruta con problemas no impide programar las demás", async () => {
      const { project, routes: rs } = await setup({ phase: "production", paths: ["/", "/a"] });
      await db.update(s.routes).set({ url: "https://host-no-permitido.test/" }).where(eq(s.routes.id, rs[0]!.id));
      await processor()(fakeJob(project.id));
      const rows = await audits();
      expect(rows).toHaveLength(2);
      expect(rows.every((a) => a.routeId === rs[1]!.id)).toBe(true);
    });
  });

  // ------------------------------------------------------------------ reconciliación
  describe("reconcile", () => {
    const later = () => new Date(Date.now() + 60 * 60_000); // simula que pasó una hora
    const run = (extra = {}) => reconcile({ db, lighthouse, maintenance, log, timeoutMs: 1000, now: later, ...extra });
    const pending = async (status: "running" | "queued") => {
      const { project, routes: [r] } = await setup();
      const [a] = await db
        .insert(s.auditLogs)
        .values({ projectId: project.id, routeId: r!.id, profile: "mobile", trigger: "manual", phaseAtRun: "development", status, startedAt: status === "running" ? new Date() : null })
        .returning();
      return a!;
    };
    const row = async (id: string) => (await db.select().from(s.auditLogs).where(eq(s.auditLogs.id, id)))[0]!;

    it("una auditoría 'en curso' sin trabajo en Redis se marca como perdida", async () => {
      const a = await pending("running");
      const report = await run();
      expect(report).toMatchObject({ lost: 1, requeued: 0 });
      expect(await row(a.id)).toMatchObject({ status: "failed", errorCode: "WORKER_LOST" });
    });

    it("una 'en curso' cuyo trabajo sigue pendiente vuelve a la cola", async () => {
      const a = await pending("running");
      await lighthouse.add("audit", { auditId: a.id }, { jobId: a.id });
      const report = await run();
      expect(report).toMatchObject({ requeued: 1, lost: 0 });
      expect(await row(a.id)).toMatchObject({ status: "queued", startedAt: null });
    });

    it("una 'en curso' reciente no se toca", async () => {
      const a = await pending("running");
      const report = await reconcile({ db, lighthouse, maintenance, log, timeoutMs: 1000 });
      expect(report).toMatchObject({ lost: 0, requeued: 0 });
      expect((await row(a.id)).status).toBe("running");
    });

    it("una 'en cola' sin trabajo se vuelve a encolar, y repetirlo no hace nada", async () => {
      const a = await pending("queued");
      expect(await run()).toMatchObject({ reenqueued: 1 });
      const job = await lighthouse.getJob(a.id);
      expect(job?.data).toEqual({ auditId: a.id });
      expect(await run()).toMatchObject({ reenqueued: 0, requeued: 0, lost: 0 });
    });

    it("una solicitud recién creada se deja en paz (aún no ha tenido tiempo de encolarse)", async () => {
      await pending("queued");
      expect(await reconcile({ db, lighthouse, maintenance, log, timeoutMs: 1000 })).toMatchObject({ reenqueued: 0 });
    });

    it("resincroniza los agendadores con la base de datos", async () => {
      const { project: prod } = await setup({ phase: "production" });
      await maintenance.removeJobScheduler(schedulerId(prod.id)); // Redis "perdió" el agendador
      const { project: dev } = await setup();
      await upsertProjectScheduler(maintenance, { id: dev.id, auditFrequency: "weekly" }); // sobra uno

      const first = await run();
      expect(first.schedulers).toMatchObject({ created: 1, removed: 1 });
      expect(await maintenance.getJobScheduler(schedulerId(prod.id))).toBeDefined();
      expect(await maintenance.getJobScheduler(schedulerId(dev.id))).toBeUndefined();

      const second = await run();
      expect(second.schedulers).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: 1 });
    });

    it("corrige un agendador con la frecuencia equivocada y respeta el de reconciliación", async () => {
      const { project } = await setup({ phase: "production", frequency: "daily" });
      await maintenance.upsertJobScheduler(schedulerId(project.id), { pattern: projectCron(project.id, "weekly"), tz: "UTC" }, { name: PLAN_JOB, data: { projectId: project.id } });
      await maintenance.upsertJobScheduler(RECONCILE_SCHEDULER_ID, { every: 60_000 }, { name: "reconcile", data: {} });
      const report = await run();
      expect(report.schedulers).toMatchObject({ updated: 1, removed: 0 });
      expect((await maintenance.getJobScheduler(schedulerId(project.id)))?.pattern).toBe(projectCron(project.id, "daily"));
      expect(await maintenance.getJobScheduler(RECONCILE_SCHEDULER_ID)).toBeDefined();
      expect((await listProjectSchedules(maintenance)).map((x) => x.projectId)).toEqual([project.id]);
    });
  });

  // ------------------------------------------------------------------- estado de la cola
  describe("getQueueStatus", () => {
    it("reúne worker, contadores, agenda de producción y últimos fallos", async () => {
      const { project, routes: [r] } = await setup({ phase: "production", frequency: "daily" });
      const { project: dev } = await setup();
      await db.insert(s.auditLogs).values({ projectId: dev.id, routeId: (await routes.listRoutes(dev.id, db))[0]!.id, profile: "desktop", trigger: "manual", phaseAtRun: "development", status: "failed", errorCode: "TIMEOUT", errorMessage: "x", finishedAt: new Date() });
      await lighthouse.add("audit", { auditId: "11111111-1111-4111-8111-111111111111" }, { jobId: "wait-1", priority: 1 });
      await redis.set("aoc:worker:heartbeat", JSON.stringify({ at: Date.now(), pid: 1, chrome: true }), "EX", 30);

      const status = await getQueueStatus({ db, redis, lighthouse, maintenance });
      expect(status.redis).toBe(true);
      expect(status.worker).toMatchObject({ online: true, chrome: true });
      expect(status.counts).toMatchObject({ waiting: 1, active: 0 });
      expect(status.schedules).toHaveLength(1);
      expect(status.schedules[0]).toMatchObject({ projectId: project.id, frequency: "daily", clientName: "Acme" });
      expect(status.schedules[0]!.next!.getTime()).toBeGreaterThan(Date.now());
      expect(status.recentFailures).toHaveLength(1);
      expect(status.recentFailures[0]).toMatchObject({ errorCode: "TIMEOUT", routePath: "/", projectName: "Sitio" });
      void r;
      await redis.del("aoc:worker:heartbeat");
    });

    it("un proyecto en producción sin agendador aparece como pendiente de agendar", async () => {
      const { project } = await setup({ phase: "production" });
      await maintenance.removeJobScheduler(schedulerId(project.id));
      const status = await getQueueStatus({ db, redis, lighthouse, maintenance });
      expect(status.schedules[0]).toMatchObject({ projectId: project.id, next: null });
    });

    it("sin latido, el worker figura fuera de línea", async () => {
      await redis.del("aoc:worker:heartbeat");
      const status = await getQueueStatus({ db, redis, lighthouse, maintenance });
      expect(status.worker).toEqual({ online: false, chrome: null, lastBeatAt: null });
    });

    it("si Redis no responde, sigue mostrando lo que hay en la base de datos", async () => {
      const { project } = await setup({ phase: "production" });
      const dead = { get: async () => { throw new Error("redis caído"); } } as never;
      const status = await getQueueStatus({ db, redis: dead, lighthouse, maintenance });
      expect(status.redis).toBe(false);
      expect(status.counts).toBeNull();
      expect(status.worker.online).toBe(false);
      expect(status.schedules[0]).toMatchObject({ projectId: project.id, next: null });
    });
  });

  // ------------------------------------------------------- el agendador dispara de verdad
  describe("worker con agendador", () => {
    const env = (): WorkerEnv => ({
      NODE_ENV: "test", LOG_LEVEL: "error", DATABASE_URL: dbUrl!, REDIS_URL: redisUrl!, R2_ENDPOINT: s3.url, R2_REGION: "auto",
      R2_BUCKET: "reportes", R2_ACCESS_KEY_ID: "ak", R2_SECRET_ACCESS_KEY: "sk", CHROME_PATH: undefined,
      AUDIT_COOLDOWN_MS: 30, AUDIT_TIMEOUT_MS: 5000, AUDIT_ATTEMPTS: 3,
      APP_URL: "http://localhost:3000", SMTP_PORT: 587,
    });
    const okRunner: LighthouseRunner = async () => ({ lhr: structuredClone(fixture) as never });

    it("al arrancar registra los agendadores de los proyectos en producción y la reconciliación periódica", async () => {
      const { project } = await setup({ phase: "production" });
      await maintenance.removeJobScheduler(schedulerId(project.id));
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: log });
      expect(await maintenance.getJobScheduler(schedulerId(project.id))).toBeDefined();
      expect(await maintenance.getJobScheduler(RECONCILE_SCHEDULER_ID)).toMatchObject({ every: 15 * 60_000 });
      expect(await maintenance.getJobScheduler(NOTIFY_SCHEDULER_ID)).toMatchObject({ every: 5 * 60_000, name: "notify" });
      expect(await maintenance.getJobScheduler(BACKUP_SCHEDULER_ID)).toMatchObject({ pattern: "17 3 * * *", tz: "UTC", name: "backup" });
      expect(await maintenance.getJobScheduler(CRUX_SCHEDULER_ID)).toMatchObject({ pattern: "47 4 * * *", tz: "UTC", name: "crux" });
    });

    it("ejecuta la actualización de datos reales pedida a la cola y guarda lo que devuelve Google", async () => {
      const { project } = await setup({ phase: "production", paths: ["/"] });
      const seen: string[] = [];
      const cruxFetch = (async (_u: string, init: { headers: Record<string, string>; body: string }) => {
        seen.push(init.headers["X-Goog-Api-Key"] ?? "");
        return { status: 200, ok: true, json: async () => ({ record: { metrics: { largest_contentful_paint: { histogram: [{ density: 1 }, { density: 0 }, { density: 0 }], percentiles: { p75: 1200 } } } } }) };
      }) as never;
      worker = await startWorker({ env: { ...env(), CRUX_API_KEY: "CLAVE-DE-PRUEBA" }, runner: okRunner, allowPrivate: true, logger: log, cruxFetch });
      await maintenance.add(CRUX_JOB, {}, { jobId: "crux-manual", removeOnComplete: true });
      // El worker anota el resultado al terminar la ronda (con una pausa entre consultas): se espera a eso.
      const run = await waitFor(async () => (await db.select().from(s.settings).where(eq(s.settings.key, "crux_last_run")))[0]?.value as { ok?: boolean } | undefined, 30_000);
      expect(run).toMatchObject({ ok: true, withData: 4 });
      expect((await db.select().from(s.fieldData).where(eq(s.fieldData.projectId, project.id))).length).toBe(4);
      expect(new Set(seen)).toEqual(new Set(["CLAVE-DE-PRUEBA"]));
    });

    it("sin CRUX_API_KEY en el worker no consulta y deja el motivo anotado", async () => {
      await setup({ phase: "production", paths: ["/"] });
      let called = 0;
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: log, cruxFetch: (async () => (called++, { status: 200, ok: true, json: async () => ({}) })) as never });
      await maintenance.add(CRUX_JOB, {}, { jobId: "crux-manual", removeOnComplete: true });
      const run = await waitFor(async () => (await db.select().from(s.settings).where(eq(s.settings.key, "crux_last_run")))[0]?.value as { error?: string } | undefined, 20_000);
      expect(run.error).toBe("NO_KEY");
      expect(called).toBe(0);
    });

    it("ejecuta el respaldo pedido a la cola de mantenimiento y lo sube a R2", async () => {
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: log });
      await maintenance.add(BACKUP_JOB, {}, { jobId: "backup-manual", removeOnComplete: true });
      await waitFor(async () => [...s3.objects.keys()].some((k) => k.startsWith("_backups/postgres/")) || undefined);
      const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "last_backup"));
      expect((row!.value as { key: string }).key).toMatch(/^_backups\/postgres\//);
    });

    it("cuando el agendador se dispara, el worker encola y ejecuta las auditorías de punta a punta", async () => {
      const { project } = await setup({ phase: "production", paths: ["/", "/a"] });
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: process.env.DEBUG_WORKER ? pino({ level: "debug" }) : log });
      // Sustituye el cron por un disparo rápido, con el mismo trabajo que registra el servicio.
      await maintenance.upsertJobScheduler(schedulerId(project.id), { every: 250 }, { name: PLAN_JOB, data: { projectId: project.id } });

      await waitFor(async () => (await audits()).length >= 4 && (await maintenance.removeJobScheduler(schedulerId(project.id)), true));
      await waitFor(async () => (await audits()).every((a) => a.status === "succeeded" || a.status === "failed"));
      const rows = await audits();
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(rows.every((a) => a.trigger === "scheduled" && a.status === "succeeded" && a.phaseAtRun === "production")).toBe(true);
      expect(new Set(rows.map((a) => a.profile))).toEqual(new Set(["mobile", "desktop"]));
      expect(s3.objects.size).toBeGreaterThanOrEqual(4);
    }, 30_000);
  });
});
