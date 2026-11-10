import { createServer, type Server } from "node:http";
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
import { lighthouseQueue, PRIORITY } from "@/server/queue/queues";
import { getFirstScanSummary, requestAudit, requestFirstScan } from "@/server/services/audits";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import type { HostResolver } from "@/worker/host-pin";
import type { ChromiumProbe, ChromiumProbeFn, ChromiumVariant } from "@/worker/lighthouse/chromium-probe";
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
  const start = async (runner: LighthouseRunner, resolver?: HostResolver, chromiumProbe?: ChromiumProbeFn) => {
    worker = await startWorker({ env: env(), runner, allowPrivate: true, resolver, chromiumProbe, logger: pino({ level: "silent" }), heartbeatIntervalMs: 100 });
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
  async function setup(opts: { phase?: "development" | "production"; paths?: string[]; baseUrl?: string } = {}) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(
      client.id,
      { name: "Sitio", baseUrl: opts.baseUrl ?? "http://127.0.0.1:18123", phase: opts.phase ?? "development" },
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

  // --------------------------------------------------------------- primer escaneo
  describe("primer escaneo de todas las rutas", () => {
    const scan = (projectId: string, q: unknown = queue) => requestFirstScan(projectId, "test", { db, queue: q as never, redis });
    const auditsOf = () => db.select().from(s.auditLogs);

    it("sin worker en línea no encola nada", async () => {
      const { project } = await setup({ paths: ["/", "/a"] });
      await expect(scan(project.id)).rejects.toMatchObject({ code: "UPSTREAM", message: expect.stringContaining("worker") });
      expect(await auditsOf()).toHaveLength(0);
    });

    it("encola móvil y escritorio de todas las rutas con prioridad de lote, y repetirlo no duplica", async () => {
      const { project } = await setup({ paths: ["/", "/a", "/b"] });
      await online();
      const first = await scan(project.id);
      expect(first).toMatchObject({ created: 6, routes: 3, alreadyPending: 0, skippedAuth: 0, routesWithoutRoom: 0 });
      const rows = await auditsOf();
      expect(rows).toHaveLength(6);
      expect(rows.every((a) => a.status === "queued" && a.trigger === "manual" && a.requestedBy === "test")).toBe(true);
      for (const a of rows) {
        const job = await queue.getJob(a.id);
        expect(job?.data).toEqual({ auditId: a.id });
        expect(job?.opts.priority).toBe(PRIORITY.bulk);
      }
      // Un «Auditar» individual va por delante del lote.
      expect(PRIORITY.manual).toBeLessThan(PRIORITY.bulk);

      const again = await scan(project.id);
      expect(again).toMatchObject({ created: 0, routes: 0, alreadyPending: 6 });
      expect(await auditsOf()).toHaveLength(6);
    });

    it("no repite lo que ya tiene una auditoría correcta y completa lo que falta", async () => {
      const { project, routes: [a, b] } = await setup({ paths: ["/a", "/b"] });
      await online();
      await scan(project.id);
      await db.update(s.auditLogs).set({ status: "succeeded", finishedAt: new Date() }).where(eq(s.auditLogs.routeId, a!.id));
      await db.delete(s.auditLogs).where(eq(s.auditLogs.routeId, b!.id));
      await queue.obliterate({ force: true });

      expect(await getFirstScanSummary(project.id, db)).toMatchObject({ routesToScan: 1, auditsToQueue: 2, alreadyPending: 0 });
      const res = await scan(project.id);
      expect(res).toMatchObject({ created: 2, routes: 1 });
      expect((await auditsOf()).filter((x) => x.routeId === a!.id)).toHaveLength(2);
      expect(await getFirstScanSummary(project.id, db)).toMatchObject({ routesToScan: 0, auditsToQueue: 0, alreadyPending: 2 });
    });

    it("reintenta lo que falló antes", async () => {
      const { project, routes: [a] } = await setup({ paths: ["/a"] });
      await online();
      await scan(project.id);
      await db.update(s.auditLogs).set({ status: "failed", finishedAt: new Date(), errorCode: "TIMEOUT" }).where(eq(s.auditLogs.routeId, a!.id));
      await queue.obliterate({ force: true });
      expect(await scan(project.id)).toMatchObject({ created: 2, routes: 1 });
    });

    it("ignora las rutas inactivas", async () => {
      const { project, routes: [a] } = await setup({ paths: ["/a", "/b"] });
      await routes.setRouteMonitored(a!.id, false, db);
      await online();
      expect(await scan(project.id)).toMatchObject({ created: 2, routes: 1 });
      expect((await auditsOf()).every((x) => x.routeId !== a!.id)).toBe(true);
    });

    it("omite las rutas que piden sesión mientras el proyecto no tenga acceso configurado", async () => {
      const { project, routes: [pub, priv] } = await setup({ paths: ["/a", "/privada"] });
      await routes.updateRouteDetails(priv!.id, { requiresAuth: true }, db);
      await online();
      expect(await getFirstScanSummary(project.id, db)).toMatchObject({ routesToScan: 1, skippedAuth: 1 });
      const sin = await scan(project.id);
      expect(sin).toMatchObject({ created: 2, routes: 1, skippedAuth: 1 });
      expect((await auditsOf()).every((x) => x.routeId === pub!.id)).toBe(true);

      await db.update(s.projects).set({ authStrategy: "cookie", authConfigEnc: Buffer.from("cifrado") }).where(eq(s.projects.id, project.id));
      const con = await scan(project.id);
      expect(con).toMatchObject({ created: 2, routes: 1, skippedAuth: 0 });
    });

    it("omite las rutas cuyo host ya no está permitido", async () => {
      const { project } = await setup({ paths: ["/a"] });
      await db.update(s.projects).set({ allowedHosts: ["otro.test"] }).where(eq(s.projects.id, project.id));
      await online();
      expect(await scan(project.id)).toMatchObject({ created: 0, skippedHost: 1 });
      expect(await auditsOf()).toHaveLength(0);
    });

    it("con la cola casi llena encola hasta el cupo, rutas completas, e informa las que faltan", async () => {
      const { project } = await setup({ paths: ["/a", "/b", "/c"] });
      await online();
      // Esperan 47 de 50: caben 3 trabajos, o sea una ruta completa (2) y no la siguiente (otros 2).
      const nearlyFull = { add: queue.add.bind(queue), getJobCounts: async () => ({ waiting: 47 }) };
      const res = await scan(project.id, nearlyFull);
      expect(res).toMatchObject({ created: 2, routes: 1, routesWithoutRoom: 2 });
      expect(await auditsOf()).toHaveLength(2);

      // Con la cola llena del todo no se encola nada, pero no es un error.
      const full = { add: queue.add.bind(queue), getJobCounts: async () => ({ waiting: 50 }) };
      expect(await scan(project.id, full)).toMatchObject({ created: 0, routesWithoutRoom: 2 });
    });

    it("si Redis falla al encolar, la fila no queda bloqueando la ruta", async () => {
      const { project } = await setup({ paths: ["/a"] });
      await online();
      const broken = { add: async () => { throw new Error("redis caído"); }, getJobCounts: async () => ({}) };
      await expect(scan(project.id, broken)).rejects.toMatchObject({ code: "UPSTREAM" });
      expect((await auditsOf()).every((x) => x.status === "failed" && x.errorCode === "QUEUE_UNAVAILABLE")).toBe(true);
      expect(await scan(project.id)).toMatchObject({ created: 2 });
    });

    it("rechaza un proyecto que no existe", async () => {
      await online();
      await expect(scan("no-es-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(scan("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
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
      // Lo que hay que mejorar queda guardado al terminar, para que el portal no abra el JSON completo.
      expect(done.improvements).toMatchObject({ v: 2, categories: expect.any(Object) });
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

    describe("un 4xx del sitio", () => {
      // Un sitio que rechaza (403) a quien le llega por 127.0.0.1 y deja pasar a 127.0.0.2: así se distingue la IP fijada del DNS normal.
      let site: Server;
      beforeAll(async () => {
        site = createServer((req, res) => {
          res.writeHead(req.socket.localAddress?.endsWith("127.0.0.1") ? 403 : 200, { server: "sitio-de-prueba" });
          res.end("ok");
        });
        await new Promise<void>((r) => site.listen(18123, "0.0.0.0", r));
      });
      afterAll(() => new Promise<void>((r) => site.close(() => r())));
      const forbidden = () => new LighthouseRuntimeError("ERRORED_DOCUMENT_REQUEST", "Status code: 403");

      it("falla sin reintentos y deja en el mensaje la prueba hecha desde el worker", async () => {
        const { routes: [r] } = await setup();
        let calls = 0;
        await start(async () => {
          calls++;
          throw forbidden();
        });
        const { audits: [a] } = await req(r!.id, ["mobile"]);
        const done = await waitFor(finished(a!.id));
        expect(calls).toBe(1);
        expect(done).toMatchObject({ status: "failed", attempts: 1, errorCode: "HTTP_4XX" });
        expect(done.errorMessage).toContain("La página respondió con error 403.");
        expect(done.errorMessage).toContain("Prueba desde el worker: DNS normal 403 · otro agente 403 (servidor: sitio-de-prueba).");
      });

      it("un 429 se reintenta con el retroceso normal y termina bien", async () => {
        const { routes: [r] } = await setup();
        let calls = 0;
        await start(async () => {
          if (++calls === 1) throw new LighthouseRuntimeError("ERRORED_DOCUMENT_REQUEST", "Status code: 429");
          return okRunner({} as never);
        });
        const { audits: [a] } = await req(r!.id, ["mobile"]);
        const done = await waitFor(finished(a!.id));
        expect(calls).toBe(2);
        expect(done).toMatchObject({ status: "succeeded", attempts: 2 });
      });

      it("si la culpable es la IP fijada, reintenta una vez con el DNS normal y la auditoría sale bien", async () => {
        const { routes: [r] } = await setup({ baseUrl: "http://pin.test:18123" });
        const pins: Array<unknown> = [];
        let lookups = 0;
        const resolver: HostResolver = async () => [{ address: ++lookups === 1 ? "127.0.0.1" : "127.0.0.2", family: 4 }];
        await start(async (input) => {
          pins.push(input.pinnedHost);
          if (input.pinnedHost) throw forbidden();
          return okRunner({} as never);
        }, resolver);
        const { audits: [a] } = await req(r!.id, ["mobile"]);
        const done = await waitFor(finished(a!.id));
        expect(done).toMatchObject({ status: "succeeded", attempts: 1, errorCode: null });
        expect(pins).toEqual([{ host: "pin.test", ip: "127.0.0.1" }, undefined]);
      });
    });

    describe("403 solo para el navegador", () => {
      // El sitio responde 200 a las peticiones sencillas (127.0.0.2) pero Lighthouse recibe 403: lo distingue por Chromium, no por la IP.
      let site: Server;
      beforeAll(async () => {
        site = createServer((_q, res) => void res.writeHead(200, { server: "hcdn" }).end("ok"));
        await new Promise<void>((r) => site.listen(18123, "0.0.0.0", r));
      });
      afterAll(() => new Promise<void>((r) => site.close(() => r())));
      const resolver: HostResolver = async () => [{ address: "127.0.0.2", family: 4 }];
      const lever: ChromiumVariant = { id: "stealth", label: "sin señales de automatización", flags: ["--x-palanca"], pin: true };
      const variant = (v: ChromiumVariant, status: number, excerpt = "") => ({ variant: v, status, server: null, excerpt });
      const base: ChromiumVariant = { id: "base", label: "Chromium", flags: [], pin: true };
      const forbiddenUnlessLever: LighthouseRunner = async (input) => {
        if (!input.extraChromeFlags?.includes("--x-palanca")) throw new LighthouseRuntimeError("ERRORED_DOCUMENT_REQUEST", "Status code: 403");
        return okRunner(input);
      };

      it("si una variante de Chromium abre la puerta, reintenta con ella y la auditoría sale bien", async () => {
        const { routes: [r] } = await setup({ baseUrl: "http://pin.test:18123" });
        const probe: ChromiumProbe = { attempts: [variant(base, 403, "Access denied"), variant(lever, 200)], winner: lever };
        await start(forbiddenUnlessLever, resolver, async () => probe);
        const { audits: [a] } = await req(r!.id, ["mobile"]);
        const done = await waitFor(finished(a!.id));
        expect(done).toMatchObject({ status: "succeeded", attempts: 1, errorCode: null });
      });

      it("si ninguna variante pasa, falla y el mensaje cuenta lo que recibió Chromium", async () => {
        const { routes: [r] } = await setup({ baseUrl: "http://pin.test:18123" });
        const probe: ChromiumProbe = { attempts: [variant(base, 403, "Access denied"), variant(lever, 403)], winner: null };
        await start(forbiddenUnlessLever, resolver, async () => probe);
        const { audits: [a] } = await req(r!.id, ["mobile"]);
        const done = await waitFor(finished(a!.id));
        expect(done).toMatchObject({ status: "failed", errorCode: "HTTP_4XX" });
        expect(done.errorMessage).toContain("Prueba desde el worker: IP fijada 200 · DNS normal 200 · otro agente 200");
        expect(done.errorMessage).toContain("Navegador: Chromium 403 «Access denied» · sin señales de automatización 403.");
      });
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
