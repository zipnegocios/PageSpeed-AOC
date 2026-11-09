import { gunzipSync } from "node:zlib";
import pino from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import fixture from "../fixtures/lhr-minimal.json";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import type { WorkerEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { LighthouseRuntimeError } from "@/server/domain/audit-errors";
import { createRedis } from "@/server/queue/connection";
import { readHeartbeat, writeHeartbeat } from "@/server/queue/heartbeat";
import { lighthouseQueue } from "@/server/queue/queues";
import { requestAudit } from "@/server/services/audits";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { startWorker, type RunningWorker } from "@/worker/start";
import type { LighthouseRunner } from "@/worker/lighthouse/runner";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const ready = Boolean(dbUrl && redisUrl);

const COOLDOWN = 60;

async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("tiempo de espera agotado");
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe.skipIf(!ready)("flujo de auditorías: solicitud → cola → worker → R2", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const redis = createRedis(redisUrl ?? "redis://localhost:6379");
  const queue = lighthouseQueue(redis);
  let s3: FakeS3;
  let worker: RunningWorker | undefined;

  const env = (): WorkerEnv => ({
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    DATABASE_URL: dbUrl!,
    REDIS_URL: redisUrl!,
    R2_ENDPOINT: s3.url,
    R2_REGION: "auto",
    R2_BUCKET: "reportes",
    R2_ACCESS_KEY_ID: "ak",
    R2_SECRET_ACCESS_KEY: "sk",
    CHROME_PATH: undefined,
    AUDIT_COOLDOWN_MS: COOLDOWN,
    AUDIT_TIMEOUT_MS: 5000,
    AUDIT_ATTEMPTS: 3,
    APP_URL: "http://localhost:3000",
    SMTP_PORT: 587,
  });

  const okRunner: LighthouseRunner = async () => ({ lhr: structuredClone(fixture) as never });
  const start = async (runner: LighthouseRunner) => {
    worker = await startWorker({ env: env(), runner, allowPrivate: true, logger: pino({ level: "silent" }), heartbeatIntervalMs: 100 });
  };

  beforeAll(async () => {
    process.env.AUDIT_RETRY_DELAY_MS = "120";
    process.env.AUDIT_ATTEMPTS = "3";
    await runMigrations(dbUrl!, "./drizzle");
    s3 = await startFakeS3();
  });
  afterAll(async () => {
    await queue.close();
    await redis.quit();
    await pool.end();
    await s3.close();
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    s3.objects.clear();
    s3.failWith(null);
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await redis.del("aoc:worker:heartbeat");
  });

  /** Proyecto con una ruta; usa una IP literal para no depender de DNS. */
  async function setup(opts: { phase?: "development" | "production"; paths?: string[] } = {}) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(
      client.id,
      { name: "Sitio", baseUrl: "http://127.0.0.1:18123", phase: opts.phase ?? "development" },
      db,
    );
    const created = [];
    for (const path of opts.paths ?? ["/"]) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }
  const online = () => writeHeartbeat(redis, { chrome: true });
  const row = async (id: string) => (await db.select().from(s.auditLogs).where(eq(s.auditLogs.id, id)))[0]!;
  const finished = (id: string) => () => row(id).then((r) => (r.status === "succeeded" || r.status === "failed" ? r : undefined));
  const req = (routeId: string, profiles?: Array<"mobile" | "desktop">) =>
    requestAudit({ routeId, profiles, trigger: "manual", requestedBy: "test" }, { db, queue, redis });

  // ------------------------------------------------------------------ solicitud
  describe("solicitud", () => {
    it("sin worker en línea no encola y no deja filas huérfanas", async () => {
      const { routes: [r] } = await setup();
      await expect(req(r!.id, ["mobile"])).rejects.toMatchObject({ code: "UPSTREAM", message: expect.stringContaining("worker") });
      expect(await db.select().from(s.auditLogs)).toHaveLength(0);
    });

    it("en desarrollo audita uno o ambos perfiles y crea la fila en cola con su trabajo", async () => {
      const { routes: [r] } = await setup();
      await online();
      const both = await req(r!.id, ["mobile", "desktop"]);
      expect(both).toMatchObject({ created: 2, alreadyPending: 0 });
      expect(both.audits.map((a) => a.profile).sort()).toEqual(["desktop", "mobile"]);
      await db.delete(s.auditLogs);
      await queue.obliterate({ force: true });
      const res = await req(r!.id, ["desktop"]);
      expect(res).toMatchObject({ created: 1, alreadyPending: 0 });
      const audit = res.audits[0]!;
      expect(audit).toMatchObject({ status: "queued", profile: "desktop", trigger: "manual", phaseAtRun: "development", requestedBy: "test" });
      const job = await queue.getJob(audit.id);
      expect(job?.data).toEqual({ auditId: audit.id });
      expect(job?.opts.attempts).toBe(3);
      expect(job?.opts.priority).toBe(1);
    });

    it("es idempotente: pedir lo mismo no duplica filas ni trabajos", async () => {
      const { routes: [r] } = await setup();
      await online();
      const first = await req(r!.id, ["mobile"]);
      const second = await req(r!.id, ["mobile"]);
      expect(second).toMatchObject({ created: 0, alreadyPending: 1 });
      expect(second.audits[0]!.id).toBe(first.audits[0]!.id);
      expect(await db.select().from(s.auditLogs)).toHaveLength(1);
      const counts = await queue.getJobCounts("waiting", "prioritized");
      expect((counts.waiting ?? 0) + (counts.prioritized ?? 0)).toBe(1);
    });

    it("en producción audita ambos perfiles por defecto", async () => {
      const { routes: [r] } = await setup({ phase: "production" });
      await online();
      const res = await req(r!.id);
      expect(res.audits.map((a) => a.profile).sort()).toEqual(["desktop", "mobile"]);
      expect(res.audits.every((a) => a.phaseAtRun === "production")).toBe(true);
    });

    it("rechaza rutas cuyo host ya no está permitido o cuyo proyecto fue archivado", async () => {
      const { project, routes: [r] } = await setup();
      await online();
      await db.update(s.projects).set({ allowedHosts: ["otro.test"] }).where(eq(s.projects.id, project.id));
      await expect(req(r!.id, ["mobile"])).rejects.toMatchObject({ code: "FORBIDDEN_HOST" });
      await projects.archiveProject(project.id, db);
      await expect(req(r!.id, ["mobile"])).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(req("no-es-uuid", ["mobile"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("si Redis falla al encolar, la fila no queda bloqueando la ruta", async () => {
      const { routes: [r] } = await setup();
      await online();
      const broken = { add: async () => { throw new Error("redis caído"); }, getJobCounts: async () => ({}) } as never;
      await expect(requestAudit({ routeId: r!.id, profiles: ["mobile"], trigger: "manual", requestedBy: "t" }, { db, queue: broken, redis })).rejects.toMatchObject({ code: "UPSTREAM" });
      const [audit] = await db.select().from(s.auditLogs);
      expect(audit).toMatchObject({ status: "failed", errorCode: "QUEUE_UNAVAILABLE" });
      // La ruta queda libre: se puede volver a pedir.
      expect((await req(r!.id, ["mobile"])).created).toBe(1);
    });

    it("rechaza solicitudes manuales cuando la cola está llena", async () => {
      const { routes: [r] } = await setup();
      await online();
      const full = { add: async () => undefined, getJobCounts: async () => ({ waiting: 50 }) } as never;
      await expect(requestAudit({ routeId: r!.id, profiles: ["mobile"], trigger: "manual", requestedBy: "t" }, { db, queue: full, redis })).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // --------------------------------------------------------------------- worker
  describe("worker", () => {
    it("ejecuta, guarda el JSON comprimido en R2 y deja las métricas en Postgres", async () => {
      const { routes: [r] } = await setup();
      await start(okRunner);
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      const done = await waitFor(finished(a!.id));

      expect(done).toMatchObject({
        status: "succeeded",
        attempts: 1,
        scorePerformance: 100,
        scoreAccessibility: 95,
        scoreSeo: 100,
        scoreBestPractices: 96,
        lcpMs: 641,
        tbtMs: 0,
        ttfbMs: 9,
        inpMs: null,
        lighthouseVersion: "13.6.0",
        httpStatus: 200,
        errorCode: null,
      });
      expect(done.durationMs).toBeGreaterThanOrEqual(0);
      expect(done.finishedAt).toBeInstanceOf(Date);
      expect(done.r2Key).toMatch(/^acme\/sitio\/\d{4}\/\d{2}\/\d{8}T\d{6}Z_home_mobile_[0-9a-f-]{36}\.json\.gz$/);

      const stored = s3.objects.get(done.r2Key!)!;
      expect(stored).toBeDefined();
      expect(JSON.parse(gunzipSync(stored).toString("utf8")).categories.performance.score).toBe(1);
    });

    it("publica un latido mientras corre y lo retira al cerrar", async () => {
      await start(okRunner);
      expect((await readHeartbeat(redis))?.chrome).toBe(true);
      await worker!.close();
      worker = undefined;
      expect(await readHeartbeat(redis)).toBeNull();
    });

    it("reintenta un fallo técnico y termina bien al segundo intento", async () => {
      const { routes: [r] } = await setup();
      let calls = 0;
      await start(async () => {
        if (++calls === 1) throw new LighthouseRuntimeError("NO_FCP", "sin contenido");
        return okRunner({} as never);
      });
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      const done = await waitFor(finished(a!.id));
      expect(calls).toBe(2);
      expect(done).toMatchObject({ status: "succeeded", attempts: 2, errorCode: null });
    });

    it("tras agotar los intentos queda fallida con el código del último error", async () => {
      const { routes: [r] } = await setup();
      let calls = 0;
      await start(async () => {
        calls++;
        throw new LighthouseRuntimeError("NO_FCP", "sin contenido");
      });
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      const done = await waitFor(finished(a!.id));
      expect(calls).toBe(3);
      expect(done).toMatchObject({ status: "failed", attempts: 3, errorCode: "NO_FCP" });
      expect(done.errorMessage).toBeTruthy();
      expect(s3.objects.size).toBe(0);
      // Fallida: la ruta queda libre para auditarse otra vez.
      expect((await req(r!.id, ["mobile"])).created).toBe(1);
    });

    it("un error no reintentable falla de inmediato, sin gastar más intentos", async () => {
      const { routes: [r] } = await setup();
      let calls = 0;
      await start(async () => {
        calls++;
        throw new LighthouseRuntimeError("INSECURE_DOCUMENT_REQUEST", "certificado");
      });
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      const done = await waitFor(finished(a!.id));
      expect(calls).toBe(1);
      expect(done).toMatchObject({ status: "failed", attempts: 1, errorCode: "TLS_ERROR" });
    });

    it("un resultado de Lighthouse con runtimeError se trata como fallo de esa causa", async () => {
      const { routes: [r] } = await setup();
      await start(async () => ({ lhr: { runtimeError: { code: "ERRORED_DOCUMENT_REQUEST", message: "Status code: 404" } } as never }));
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      const done = await waitFor(finished(a!.id));
      expect(done).toMatchObject({ status: "failed", attempts: 1, errorCode: "HTTP_4XX" });
    });

    it("si R2 rechaza el acceso, falla sin reintentos y no guarda nada", async () => {
      const { routes: [r] } = await setup();
      s3.failWith(403);
      await start(okRunner);
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      const done = await waitFor(finished(a!.id));
      expect(done).toMatchObject({ status: "failed", attempts: 1, errorCode: "R2_CONFIG", r2Key: null, scorePerformance: null });
    });

    it("descarta la auditoría si su proyecto se archiva antes de ejecutarse", async () => {
      const { project, routes: [r] } = await setup();
      await online();
      const { audits: [a] } = await req(r!.id, ["mobile"]);
      await projects.archiveProject(project.id, db);
      let calls = 0;
      await start(async () => {
        calls++;
        return okRunner({} as never);
      });
      const done = await waitFor(finished(a!.id));
      expect(calls).toBe(0);
      expect(done).toMatchObject({ status: "failed", errorCode: "NOT_FOUND" });
    });

    it("una auditoría a la vez: nunca se solapan y se respeta la pausa entre ellas", async () => {
      const { routes: rs } = await setup({ paths: ["/a", "/b", "/c", "/d", "/e", "/f"] });
      const spans: Array<{ start: number; end: number }> = [];
      let running = 0;
      let maxRunning = 0;
      await start(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        const span = { start: Date.now(), end: 0 };
        await new Promise((r) => setTimeout(r, 40));
        span.end = Date.now();
        spans.push(span);
        running--;
        return okRunner({} as never);
      });
      await online();
      const ids: string[] = [];
      for (const r of rs) ids.push((await req(r.id, ["mobile"])).audits[0]!.id);
      await Promise.all(ids.map((id) => waitFor(finished(id), 30_000)));

      expect(maxRunning).toBe(1);
      expect(spans).toHaveLength(6);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end + COOLDOWN - 15); // holgura de reloj
      }
      // Lo mismo, medido desde la base de datos: ningún intervalo started_at–finished_at se solapa.
      const overlaps = await db.execute<{ n: string }>(sql`
        select count(*) as n from audit_logs a join audit_logs b
          on a.id < b.id and a.started_at < b.finished_at and b.started_at < a.finished_at`);
      expect(overlaps.rows[0]!.n).toBe("0");
    });
  });
});
