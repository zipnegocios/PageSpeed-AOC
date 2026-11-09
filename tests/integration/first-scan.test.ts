import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { describeFirstScan } from "@/server/domain/first-scan";
import { createRedis } from "@/server/queue/connection";
import { writeHeartbeat } from "@/server/queue/heartbeat";
import { lighthouseQueue } from "@/server/queue/queues";
import { getFirstScanPlan, MAX_WAITING_JOBS, requestAudit, requestFirstScan } from "@/server/services/audits";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!(dbUrl && redisUrl))("primer escaneo de un proyecto", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const redis = createRedis(redisUrl ?? "redis://localhost:6379");
  const queue = lighthouseQueue(redis);
  const deps = { db, queue, redis };
  const online = () => writeHeartbeat(redis, { chrome: true });

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(async () => {
    await queue.close();
    redis.disconnect();
    await pool.end();
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await redis.del("aoc:worker:heartbeat");
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });

  async function setup(opts: { paths?: string[]; phase?: "development" | "production" } = {}) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Sitio", baseUrl: "http://127.0.0.1:18123", phase: opts.phase ?? "development" }, db);
    const created = [];
    for (const path of opts.paths ?? ["/", "/precios", "/contacto"]) created.push(await routes.addRoute(project.id, { path }, db));
    return { project, routes: created };
  }
  const auditRows = (projectId: string) => db.select().from(s.auditLogs).where(eq(s.auditLogs.projectId, projectId));
  // Los trabajos manuales llevan prioridad: BullMQ los cuenta como "prioritized", no como "waiting".
  const jobCount = async () => {
    const c = await queue.getJobCounts("waiting", "prioritized", "delayed");
    return (c.waiting ?? 0) + (c.prioritized ?? 0) + (c.delayed ?? 0);
  };

  it("lanza móvil y escritorio en todas las rutas sin auditoría y lo deja anotado", async () => {
    const { project } = await setup();
    await online();
    const plan = await getFirstScanPlan(project.id, db);
    expect(plan).toMatchObject({ audits: 6, skippedAuth: 0, skippedHost: 0 });
    expect(plan.items).toHaveLength(3);

    const result = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    expect(result).toEqual({ queued: 6, routesQueued: 3, alreadyPending: 0, remaining: 0, skippedAuth: 0, skippedHost: 0 });
    const rows = await auditRows(project.id);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.status === "queued" && r.trigger === "manual" && r.requestedBy === "ana@acme.test")).toBe(true);
    expect(new Set(rows.map((r) => r.profile))).toEqual(new Set(["mobile", "desktop"]));
    expect(await jobCount()).toBe(6);
    expect(describeFirstScan(result)).toContain("6 auditorías");
  });

  it("pulsarlo otra vez no duplica nada", async () => {
    const { project } = await setup();
    await online();
    await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    expect((await getFirstScanPlan(project.id, db)).audits).toBe(0);
    const again = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    expect(again).toEqual({ queued: 0, routesQueued: 0, alreadyPending: 0, remaining: 0, skippedAuth: 0, skippedHost: 0 });
    expect(describeFirstScan(again)).toBe("Todas las rutas ya tienen su primer escaneo.");
    expect(await auditRows(project.id)).toHaveLength(6);
    expect(await jobCount()).toBe(6);
  });

  it("solo completa lo que falta: lo terminado no se repite y lo fallido se reintenta", async () => {
    const { project, routes: rs } = await setup({ paths: ["/", "/precios", "/contacto"] });
    await online();
    const base = { projectId: project.id, trigger: "manual" as const, phaseAtRun: "development" as const };
    // "/": móvil terminado con éxito; "/precios": escritorio fallido; "/contacto": nada.
    await db.insert(s.auditLogs).values({ ...base, routeId: rs[0]!.id, profile: "mobile", status: "succeeded", finishedAt: new Date() });
    await db.insert(s.auditLogs).values({ ...base, routeId: rs[1]!.id, profile: "desktop", status: "failed", finishedAt: new Date() });

    const result = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    // "/" → solo escritorio (1); "/precios" → ambos (2); "/contacto" → ambos (2)
    expect(result).toMatchObject({ queued: 5, routesQueued: 3, remaining: 0 });
    const queued = (await auditRows(project.id)).filter((r) => r.status === "queued");
    expect(queued.filter((r) => r.routeId === rs[0]!.id).map((r) => r.profile)).toEqual(["desktop"]);
    expect(queued).toHaveLength(5);
  });

  it("funciona también en producción y audita rutas inactivas", async () => {
    const { project, routes: rs } = await setup({ phase: "production", paths: ["/", "/inactiva"] });
    await online();
    await routes.setRouteMonitored(rs[1]!.id, false, db);
    expect(await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps)).toMatchObject({ queued: 4, routesQueued: 2 });
  });

  it("deja para después las rutas con sesión mientras no haya acceso configurado", async () => {
    const { project } = await setup({ paths: ["/", "/cuenta"] });
    await online();
    await db.update(s.routes).set({ requiresAuth: true }).where(eq(s.routes.path, "/cuenta"));
    const result = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    expect(result).toMatchObject({ queued: 2, routesQueued: 1, skippedAuth: 1 });
    expect(describeFirstScan(result)).toMatch(/Acceso a páginas privadas/);

    // Con el acceso configurado, la ruta pendiente entra en el siguiente intento.
    await db.update(s.projects).set({ authStrategy: "cookie", authConfigEnc: Buffer.from([1, 2, 3]) }).where(eq(s.projects.id, project.id));
    expect(await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps)).toMatchObject({ queued: 2, routesQueued: 1, skippedAuth: 0 });
  });

  it("omite las rutas cuyo host ya no está permitido", async () => {
    const { project } = await setup({ paths: ["/", "/otra"] });
    await online();
    await db.update(s.routes).set({ url: "http://fuera.test/otra" }).where(eq(s.routes.path, "/otra"));
    expect(await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps)).toMatchObject({ queued: 2, routesQueued: 1, skippedHost: 1 });
  });

  it("sin worker en línea falla con el aviso de siempre y no deja filas huérfanas", async () => {
    const { project } = await setup();
    await expect(requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps)).rejects.toThrow(/worker de auditorías no está en línea/);
    expect(await auditRows(project.id)).toHaveLength(0);
  });

  it("si la cola se llena a la mitad deja lo encolado, dice cuánto quedó fuera y se completa al volver a pulsar", async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `/p${String(i).padStart(2, "0")}`);
    const { project } = await setup({ paths });
    await online();
    const first = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    // 60 auditorías en total; la cola admite 50 esperando.
    expect(first).toMatchObject({ queued: MAX_WAITING_JOBS, routesQueued: MAX_WAITING_JOBS / 2, remaining: 60 - MAX_WAITING_JOBS });
    expect(describeFirstScan(first)).toMatch(/10 auditorías quedaron sin encolar/);
    expect(await auditRows(project.id)).toHaveLength(MAX_WAITING_JOBS);

    // Con la cola todavía llena, volver a pulsar falla con el aviso de cola llena y no cambia nada.
    await expect(requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps)).rejects.toThrow(/cola de auditorías está llena/);

    // Cuando la cola avanza, el siguiente intento completa solo lo que faltaba.
    await queue.obliterate({ force: true });
    const second = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    expect(second).toMatchObject({ queued: 10, routesQueued: 5, remaining: 0 });
    expect(await auditRows(project.id)).toHaveLength(60);
  });

  it("si otra persona ya lanzó una auditoría de esa ruta, no la duplica", async () => {
    const { project, routes: rs } = await setup({ paths: ["/"] });
    await online();
    await requestAudit({ routeId: rs[0]!.id, profiles: ["mobile"], trigger: "manual", requestedBy: "luis@acme.test" }, deps);
    const result = await requestFirstScan(project.id, { requestedBy: "ana@acme.test" }, deps);
    expect(result).toMatchObject({ queued: 1, routesQueued: 1, remaining: 0 });
    expect(await auditRows(project.id)).toHaveLength(2);
  });

  it("un proyecto inexistente responde «no encontrado»", async () => {
    await expect(requestFirstScan("00000000-0000-4000-8000-000000000000", { requestedBy: "x" }, deps)).rejects.toThrow(/Proyecto no encontrado/);
    await expect(getFirstScanPlan("no-uuid", db)).rejects.toThrow(/Proyecto no encontrado/);
  });
});
