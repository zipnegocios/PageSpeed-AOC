import { Queue } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { createRedis, QUEUE_PREFIX } from "@/server/queue/connection";
import { MAINTENANCE_QUEUE } from "@/server/queue/queues";
import * as clients from "@/server/services/clients";
import { findFieldData, getLastCruxRun, listFieldData, refreshAllFieldData, refreshProjectFieldData, requestFieldDataRefresh, type FetchLike } from "@/server/services/crux";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const NOW = new Date("2026-11-03T04:47:00Z");

const record = (lcp: number) => ({
  record: {
    metrics: {
      largest_contentful_paint: { histogram: [{ start: 0, end: 2500, density: 0.6 }, { start: 2500, end: 4000, density: 0.3 }, { start: 4000, density: 0.1 }], percentiles: { p75: lcp } },
      interaction_to_next_paint: { histogram: [{ start: 0, end: 200, density: 0.9 }, { start: 200, end: 500, density: 0.1 }, { start: 500, density: 0 }], percentiles: { p75: 150 } },
      cumulative_layout_shift: { histogram: [{ start: "0.00", end: "0.10", density: 0.95 }, { start: "0.10", end: "0.25", density: 0.05 }, { start: "0.25", density: 0 }], percentiles: { p75: "0.02" } },
    },
    collectionPeriod: { firstDate: { year: 2026, month: 10, day: 5 }, lastDate: { year: 2026, month: 11, day: 1 } },
  },
});

describe.skipIf(!dbUrl)("datos reales de usuarios (CrUX)", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const calls: Array<Record<string, unknown>> = [];
  let mode: "ok" | "sin-datos" | "clave" = "ok";
  const fetchFake: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push(body);
    if (mode === "clave") return { status: 403, ok: false, json: async () => ({}) };
    // Con "sin-datos" solo las páginas concretas carecen de tráfico; el sitio entero sí lo tiene.
    if (mode === "sin-datos" && "url" in body) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => record(body.formFactor === "PHONE" ? 2900 : 1800) };
  };
  const noSleep = async () => undefined;

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    calls.length = 0;
    mode = "ok";
  });

  async function setup(phase: "development" | "production" = "production", paths = ["/", "/blog"]) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    if (phase === "production") await db.update(s.projects).set({ phase }).where(eq(s.projects.id, project.id));
    const created = [];
    for (const path of paths) created.push(await routes.addRoute(project.id, { path }, db));
    return { project, routes: created };
  }

  describe("actualización de un proyecto", () => {
    it("pide el sitio entero y cada página monitoreada, en móvil y escritorio, y lo guarda", async () => {
      const { project, routes: [home, blog] } = await setup();
      const out = await refreshProjectFieldData(project.id, { db, apiKey: "K", fetch: fetchFake, sleep: noSleep, now: () => NOW });
      expect(out).toEqual({ checked: 6, withData: 6, noData: 0 });
      expect(calls.filter((c) => "origin" in c)).toHaveLength(2);
      expect(calls.filter((c) => "url" in c).map((c) => c.url).sort()).toEqual(["https://acme.test/", "https://acme.test/", "https://acme.test/blog", "https://acme.test/blog"]);
      expect(calls.every((c) => Array.isArray(c.metrics))).toBe(true);

      const rows = await listFieldData(project.id, db);
      expect(rows).toHaveLength(6);
      const origin = await findFieldData(project.id, "origin", "mobile", db);
      expect(origin).toMatchObject({ status: "ok", first: "2026-10-05", last: "2026-11-01", fetchedAt: NOW });
      expect(origin!.metrics!.lcp).toMatchObject({ p75: 2900, good: 60 });
      expect((await findFieldData(project.id, "origin", "desktop", db))!.metrics!.lcp!.p75).toBe(1800);
      expect(await findFieldData(project.id, home!.id, "mobile", db)).not.toBeNull();
      expect(await findFieldData(project.id, blog!.id, "desktop", db)).not.toBeNull();
    });

    it("una página sin tráfico queda como 'sin datos' y no estropea el resto", async () => {
      mode = "sin-datos";
      const { project, routes: [home] } = await setup();
      const out = await refreshProjectFieldData(project.id, { db, apiKey: "K", fetch: fetchFake, sleep: noSleep });
      expect(out).toEqual({ checked: 6, withData: 2, noData: 4 });
      expect((await findFieldData(project.id, home!.id, "mobile", db))).toMatchObject({ status: "no_data", metrics: null });
      expect((await findFieldData(project.id, "origin", "mobile", db))!.status).toBe("ok");
    });

    it("volver a actualizar reemplaza lo anterior sin duplicar filas", async () => {
      const { project } = await setup("production", ["/"]);
      await refreshProjectFieldData(project.id, { db, apiKey: "K", fetch: fetchFake, sleep: noSleep, now: () => NOW });
      mode = "sin-datos";
      await refreshProjectFieldData(project.id, { db, apiKey: "K", fetch: fetchFake, sleep: noSleep, now: () => new Date(NOW.getTime() + 86_400_000) });
      const rows = await listFieldData(project.id, db);
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.status === "no_data")).toHaveLength(2);
      expect(rows.every((r) => r.fetchedAt.getTime() === NOW.getTime() + 86_400_000)).toBe(true);
    });

    it("respeta la pausa entre consultas y limita las páginas a diez", async () => {
      const { project } = await setup("production", Array.from({ length: 14 }, (_, i) => `/p${i}`));
      let pauses = 0;
      const out = await refreshProjectFieldData(project.id, { db, apiKey: "K", fetch: fetchFake, sleep: async () => void pauses++ });
      expect(out.checked).toBe((1 + 10) * 2);
      expect(pauses).toBe(out.checked);
    });

    it("al borrar el proyecto se borran sus datos", async () => {
      const { project } = await setup("production", ["/"]);
      await refreshProjectFieldData(project.id, { db, apiKey: "K", fetch: fetchFake, sleep: noSleep });
      await db.delete(s.projects).where(eq(s.projects.id, project.id));
      expect(await db.select().from(s.fieldData)).toHaveLength(0);
    });
  });

  describe("actualización diaria de todos los proyectos", () => {
    it("recorre solo los proyectos en producción y anota el resultado", async () => {
      await setup("production", ["/"]);
      await setup("development", ["/"]);
      const run = await refreshAllFieldData({ db, apiKey: "K", fetch: fetchFake, sleep: noSleep, now: () => NOW });
      expect(run).toEqual({ at: NOW.toISOString(), ok: true, projects: 1, checked: 4, withData: 4 });
      expect(await getLastCruxRun(db)).toEqual(run);
    });
    it("sin clave no consulta nada y lo anota para que el panel lo explique", async () => {
      await setup();
      const run = await refreshAllFieldData({ db, apiKey: undefined, fetch: fetchFake, now: () => NOW });
      expect(run).toMatchObject({ ok: false, error: "NO_KEY", checked: 0 });
      expect(calls).toHaveLength(0);
      expect((await getLastCruxRun(db))?.error).toBe("NO_KEY");
    });
    it("una clave rechazada corta la ronda con un código claro", async () => {
      mode = "clave";
      await setup();
      const run = await refreshAllFieldData({ db, apiKey: "MALA", fetch: fetchFake, sleep: noSleep, now: () => NOW });
      expect(run).toMatchObject({ ok: false, error: "BAD_KEY" });
      expect(calls).toHaveLength(1); // no insiste con el resto
      expect(await db.select().from(s.fieldData)).toHaveLength(0);
    });
    it("sin proyectos en producción termina bien", async () => {
      expect(await refreshAllFieldData({ db, apiKey: "K", fetch: fetchFake, now: () => NOW })).toMatchObject({ ok: true, projects: 0, checked: 0 });
    });
  });

  describe.skipIf(!redisUrl)("actualización a demanda", () => {
    it("se pide una sola vez mientras esté pendiente", async () => {
      const redis = createRedis(redisUrl!);
      const queue = new Queue(MAINTENANCE_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
      try {
        await queue.obliterate({ force: true });
        expect(await requestFieldDataRefresh({ queue })).toEqual({ queued: true });
        expect(await requestFieldDataRefresh({ queue })).toEqual({ queued: false });
        expect((await queue.getJob("crux-manual"))?.name).toBe("crux");
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        await redis.quit();
      }
    });
  });
});
