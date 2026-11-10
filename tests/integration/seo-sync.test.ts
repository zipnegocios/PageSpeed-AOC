import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { exportPKCS8, generateKeyPair } from "jose";
import pino from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fixture from "../fixtures/lhr-minimal.json";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import type { WorkerEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { createRedis } from "@/server/queue/connection";
import { writeHeartbeat } from "@/server/queue/heartbeat";
import { seoQueue } from "@/server/queue/queues";
import { SEO_SYNC_CRON, SEO_SYNC_JOB, SEO_SYNC_SCHEDULER_ID } from "@/server/queue/schedulers";
import { clearTokenCache } from "@/server/seo/google-auth";
import type { FetchLike } from "@/server/seo/http";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { saveConnection } from "@/server/services/seo-connections";
import { requestSeoSync, syncAllSeoData, syncProjectSeoData } from "@/server/services/seo-sync";
import type { LighthouseRunner } from "@/worker/lighthouse/runner";
import { startWorker, type RunningWorker } from "@/worker/start";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const KEY = randomBytes(32).toString("base64");
const EMAIL = "pagespeed@demo.iam.gserviceaccount.com";
const NOW = new Date("2026-11-10T12:00:00Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** Google simulado: cada prueba cambia solo lo que necesita. */
type Fake = { clicks: number; ga4Status: number; gscStatus: number; calls: Array<{ kind: "gsc" | "gsc-queries" | "ga4-traffic" | "ga4-ai" | "ga4-sources"; from: string; to: string }> };
const fresh = (): Fake => ({ clicks: 10, ga4Status: 200, gscStatus: 200, calls: [] });
let fake = fresh();

const fetchImpl: FetchLike = async (url, init) => {
  const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "tok", expires_in: 3600 });

  if (url.includes("searchAnalytics/query")) {
    const b = body as { startDate: string; endDate: string; startRow: number; dimensions: string[] };
    const isQueries = b.dimensions.includes("query");
    fake.calls.push({ kind: isQueries ? "gsc-queries" : "gsc", from: b.startDate, to: b.endDate });
    if (fake.gscStatus !== 200) return json({ error: { message: "x" } }, fake.gscStatus);
    if (b.startRow > 0) return json({ rows: [] });
    if (b.dimensions.includes("query")) {
      // Con qué buscan: dos consultas por día (una con mayúsculas y espacios, que se normaliza) y una con más clics.
      return json({ rows: days(b.startDate, b.endDate).flatMap((d) => [{ keys: [d, "Ingeniería  Civil"], clicks: 7, impressions: 100, ctr: 0.07, position: 3 }, { keys: [d, "grúa torre"], clicks: 2, impressions: 40, ctr: 0.05, position: 5 }]) });
    }
    const rows = days(b.startDate, b.endDate).flatMap((d) => [
      { keys: [d, "https://acme.test/es/precios", "col", "MOBILE"], clicks: fake.clicks, impressions: 100, ctr: 0.1, position: 4 },
      { keys: [d, "https://acme.test/es/precios/?utm=1", "col", "MOBILE"], clicks: 5, impressions: 50, ctr: 0.1, position: 6 },
      { keys: [d, "https://acme.test/", "usa", "DESKTOP"], clicks: 2, impressions: 40, ctr: 0.05, position: 2 },
    ]);
    return json({ rows });
  }

  if (url.includes(":runReport")) {
    const b = body as { dateRanges: Array<{ startDate: string; endDate: string }>; dimensions: Array<{ name: string }>; dimensionFilter?: unknown };
    const range = b.dateRanges[0]!;
    const isSources = !b.dimensionFilter && b.dimensions.some((x) => x.name === "sessionSource");
    fake.calls.push({ kind: isSources ? "ga4-sources" : b.dimensionFilter ? "ga4-ai" : "ga4-traffic", from: range.startDate, to: range.endDate });
    if (fake.ga4Status !== 200) return json({ error: { message: "x" } }, fake.ga4Status);
    const ymd = (d: string) => d.replaceAll("-", "");
    const rows = days(range.startDate, range.endDate).flatMap((d) =>
      isSources
        ? [
            // fecha, fuente, grupo de canal, página: el reparto completo. Dos fuentes de Facebook se suman, una red desconocida va a
            // «Otras redes», un referido conserva su dominio, Google es un buscador y «(direct)» es directo.
            { dimensionValues: [{ value: ymd(d) }, { value: "l.instagram.com" }, { value: "Organic Social" }, { value: "/es/blog" }], metricValues: [{ value: "4" }, { value: "3" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "m.facebook.com" }, { value: "Organic Social" }, { value: "/" }], metricValues: [{ value: "1" }, { value: "1" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "lm.facebook.com" }, { value: "Organic Social" }, { value: "/" }], metricValues: [{ value: "1" }, { value: "1" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "mi-red.example" }, { value: "Organic Social" }, { value: "/" }], metricValues: [{ value: "2" }, { value: "2" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "cart.com" }, { value: "Referral" }, { value: "/" }], metricValues: [{ value: "9" }, { value: "9" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "google" }, { value: "Organic Search" }, { value: "/es/precios" }], metricValues: [{ value: "6" }, { value: "5" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "(direct)" }, { value: "Direct" }, { value: "/" }], metricValues: [{ value: "3" }, { value: "3" }] },
          ]
        : b.dimensionFilter
        ? [{ dimensionValues: [{ value: ymd(d) }, { value: "chatgpt.com" }, { value: "/es/precios" }], metricValues: [{ value: "3" }, { value: "3" }] }]
        : [
            { dimensionValues: [{ value: ymd(d) }, { value: "/es/precios/" }, { value: "Colombia" }, { value: "Organic Search" }], metricValues: [{ value: "8" }, { value: "6" }] },
            { dimensionValues: [{ value: ymd(d) }, { value: "/" }, { value: "Venezuela" }, { value: "Direct" }], metricValues: [{ value: "2" }, { value: "2" }] },
          ],
    );
    return json({ rowCount: rows.length, rows });
  }
  throw new Error(`URL inesperada: ${url}`);
};

describe.skipIf(!(dbUrl && redisUrl))("descarga de datos de Search Console y GA4", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const redis = createRedis(redisUrl ?? "redis://localhost:6379");
  const queue = seoQueue(redis);
  let saKeyJson: string;
  let s3: FakeS3;
  let worker: RunningWorker | undefined;

  const deps = (extra: { now?: Date; googleEnv?: string | null } = {}) => ({ key: KEY, fetchImpl, sleep: async () => undefined, googleEnv: extra.googleEnv === undefined ? saKeyJson : extra.googleEnv, now: () => extra.now ?? NOW });

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
    s3 = await startFakeS3();
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    saKeyJson = JSON.stringify({ client_email: EMAIL, private_key: await exportPKCS8(privateKey) });
  });
  afterAll(async () => {
    await queue.close();
    redis.disconnect();
    await s3.close();
    await pool.end();
  });
  beforeEach(async () => {
    fake = fresh();
    clearTokenCache();
    await queue.obliterate({ force: true });
    await redis.del("aoc:worker:heartbeat");
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  async function setup(opts: { name?: string; connect?: Array<"gsc" | "ga4"> } = {}) {
    const client = await clients.createClient({ name: opts.name ?? "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    for (const kind of opts.connect ?? ["gsc", "ga4"]) await saveConnection(project.id, kind, { externalId: kind === "gsc" ? "acme.test" : "123456789" }, db, { key: KEY });
    return { client, project };
  }
  const integration = async (projectId: string, kind: "gsc" | "ga4") => (await db.select().from(s.seoIntegrations).where(and(eq(s.seoIntegrations.projectId, projectId), eq(s.seoIntegrations.kind, kind))))[0]!;
  const searchRows = (projectId: string) => db.select().from(s.seoSearchDaily).where(eq(s.seoSearchDaily.projectId, projectId)).orderBy(asc(s.seoSearchDaily.date), asc(s.seoSearchDaily.page));
  const count = async (table: typeof s.seoSearchDaily | typeof s.seoTrafficDaily | typeof s.seoAiReferralsDaily | typeof s.seoSourceDaily | typeof s.seoQueryDaily, projectId: string) =>
    Number((await db.select({ n: sql<number>`count(*)` }).from(table).where(eq(table.projectId, projectId)))[0]!.n);

  describe("primera descarga", () => {
    it("trae 90 días de ambas fuentes, normaliza las páginas, pondera la posición y anota hasta qué día hay datos", async () => {
      const { project } = await setup();
      const r = await syncProjectSeoData(project.id, db, deps());
      expect(r.results.map((x) => `${x.kind}:${x.ok}`).sort()).toEqual(["ga4:true", "gsc:true"]);

      // Search Console: 3 ventanas, 90 días × 2 filas (las dos URL de /es/precios se suman).
      expect(fake.calls.filter((c) => c.kind === "gsc")).toEqual([
        { kind: "gsc", from: "2026-08-10", to: "2026-09-08" },
        { kind: "gsc", from: "2026-09-09", to: "2026-10-08" },
        { kind: "gsc", from: "2026-10-09", to: "2026-11-07" },
      ]);
      expect(await count(s.seoSearchDaily, project.id)).toBe(180);
      const day = (await searchRows(project.id)).filter((x) => x.date === "2026-11-07");
      expect(day).toEqual([
        { projectId: project.id, date: "2026-11-07", page: "/", country: "usa", device: "DESKTOP", clicks: 2, impressions: 40, positionSum: 80 },
        { projectId: project.id, date: "2026-11-07", page: "/es/precios", country: "col", device: "MOBILE", clicks: 15, impressions: 150, positionSum: 4 * 100 + 6 * 50 },
      ]);

      // GA4: termina un día antes que Search Console no cierra (1 día de retraso) y guarda tráfico y visitas desde IA.
      expect(fake.calls.filter((c) => c.kind === "ga4-traffic").at(-1)).toEqual({ kind: "ga4-traffic", from: "2026-10-11", to: "2026-11-09" });
      expect(await count(s.seoTrafficDaily, project.id)).toBe(180);
      expect(await count(s.seoAiReferralsDaily, project.id)).toBe(90);
      // De dónde llegan: reparto completo (6 fuentes por día); lo que ya se descarga no se duplica.
      expect(await count(s.seoSourceDaily, project.id)).toBe(540);
      const sources = await db.select().from(s.seoSourceDaily).where(and(eq(s.seoSourceDaily.projectId, project.id), eq(s.seoSourceDaily.date, "2026-11-09")));
      expect(sources.map((r) => [r.grp, r.source, r.page, r.sessions, r.users]).sort()).toEqual([
        ["direct", "direct", "/", 3, 3],
        ["referral", "cart.com", "/", 9, 9],
        ["search", "google", "/es/precios", 6, 5],
        ["social", "facebook", "/", 2, 2], // m.facebook.com y lm.facebook.com se suman
        ["social", "instagram", "/es/blog", 4, 3],
        ["social", "other", "/", 2, 2],
      ]);
      // Con qué buscan: la consulta se normaliza (minúsculas, un solo espacio) y se guarda por día.
      expect(await count(s.seoQueryDaily, project.id)).toBe(180);
      const q = await db.select().from(s.seoQueryDaily).where(and(eq(s.seoQueryDaily.projectId, project.id), eq(s.seoQueryDaily.date, "2026-11-07")));
      expect(q.map((r) => [r.query, r.clicks, r.impressions, r.positionSum]).sort()).toEqual([["grúa torre", 2, 40, 200], ["ingeniería civil", 7, 100, 300]]);
      const traffic = await db.select().from(s.seoTrafficDaily).where(and(eq(s.seoTrafficDaily.projectId, project.id), eq(s.seoTrafficDaily.date, "2026-11-09")));
      expect(traffic.map((t) => [t.page, t.country, t.channel, t.sessions, t.users]).sort()).toEqual([
        ["/", "Venezuela", "Direct", 2, 2],
        ["/es/precios", "Colombia", "Organic Search", 8, 6],
      ]);
      expect((await db.select().from(s.seoAiReferralsDaily).where(eq(s.seoAiReferralsDaily.date, "2026-11-09")))[0]).toMatchObject({ source: "chatgpt.com", page: "/es/precios", sessions: 3 });

      const gsc = await integration(project.id, "gsc");
      const ga4 = await integration(project.id, "ga4");
      expect(gsc).toMatchObject({ syncedThrough: "2026-11-07", syncStatus: "ok", lastSyncAt: NOW });
      expect(ga4).toMatchObject({ syncedThrough: "2026-11-09", syncStatus: "ok" });
      expect(gsc.syncDetail).toBe("Se guardaron 180 filas de 2026-08-10 a 2026-11-07.");
    });
  });

  describe("descargas siguientes", () => {
    it("repetirla el mismo día no duplica nada: repasa solo la última semana y deja lo mismo", async () => {
      const { project } = await setup();
      await syncProjectSeoData(project.id, db, deps());
      fake.calls = [];
      const again = await syncProjectSeoData(project.id, db, deps());
      expect(again.results.every((x) => x.ok)).toBe(true);
      expect(fake.calls.filter((c) => c.kind === "gsc")).toEqual([{ kind: "gsc", from: "2026-11-01", to: "2026-11-07" }]);
      expect(await count(s.seoSearchDaily, project.id)).toBe(180);
      expect(await count(s.seoTrafficDaily, project.id)).toBe(180);
      expect(await count(s.seoAiReferralsDaily, project.id)).toBe(90);
      // De dónde llegan: reparto completo (6 fuentes por día); lo que ya se descarga no se duplica.
      expect(await count(s.seoSourceDaily, project.id)).toBe(540);
      const sources = await db.select().from(s.seoSourceDaily).where(and(eq(s.seoSourceDaily.projectId, project.id), eq(s.seoSourceDaily.date, "2026-11-09")));
      expect(sources.map((r) => [r.grp, r.source, r.page, r.sessions, r.users]).sort()).toEqual([
        ["direct", "direct", "/", 3, 3],
        ["referral", "cart.com", "/", 9, 9],
        ["search", "google", "/es/precios", 6, 5],
        ["social", "facebook", "/", 2, 2], // m.facebook.com y lm.facebook.com se suman
        ["social", "instagram", "/es/blog", 4, 3],
        ["social", "other", "/", 2, 2],
      ]);
      // Con qué buscan: la consulta se normaliza (minúsculas, un solo espacio) y se guarda por día.
      expect(await count(s.seoQueryDaily, project.id)).toBe(180);
      const q = await db.select().from(s.seoQueryDaily).where(and(eq(s.seoQueryDaily.projectId, project.id), eq(s.seoQueryDaily.date, "2026-11-07")));
      expect(q.map((r) => [r.query, r.clicks, r.impressions, r.positionSum]).sort()).toEqual([["grúa torre", 2, 40, 200], ["ingeniería civil", 7, 100, 300]]);
    });

    it("al día siguiente avanza una fecha y suma solo el día nuevo", async () => {
      const { project } = await setup();
      await syncProjectSeoData(project.id, db, deps());
      await syncProjectSeoData(project.id, db, deps({ now: new Date("2026-11-11T12:00:00Z") }));
      expect(await count(s.seoSearchDaily, project.id)).toBe(182);
      expect((await integration(project.id, "gsc")).syncedThrough).toBe("2026-11-08");
      expect((await integration(project.id, "ga4")).syncedThrough).toBe("2026-11-10");
    });

    it("lo que Google corrige en la última semana se actualiza y lo anterior no se toca", async () => {
      const { project } = await setup();
      await syncProjectSeoData(project.id, db, deps());
      fake.clicks = 99;
      await syncProjectSeoData(project.id, db, deps());
      const rows = await searchRows(project.id);
      expect(rows.find((x) => x.date === "2026-11-05" && x.page === "/es/precios")?.clicks).toBe(99 + 5);
      expect(rows.find((x) => x.date === "2026-10-20" && x.page === "/es/precios")?.clicks).toBe(15);
    });

    it("una ventana que se repite sustituye los datos: lo que Google ya no devuelve desaparece", async () => {
      const { project } = await setup({ connect: ["gsc"] });
      await syncProjectSeoData(project.id, db, deps());
      await db.insert(s.seoSearchDaily).values({ projectId: project.id, date: "2026-11-03", page: "/vieja", country: "col", device: "MOBILE", clicks: 1, impressions: 1, positionSum: 1 });
      await syncProjectSeoData(project.id, db, deps());
      expect((await searchRows(project.id)).some((x) => x.page === "/vieja")).toBe(false);
    });

    it("ignora las filas que Google devuelva fuera de la ventana pedida", async () => {
      const { project } = await setup({ connect: ["gsc"] });
      const rare: typeof fetchImpl = async (url, init) => {
        const res = await fetchImpl(url, init);
        if (!url.includes("searchAnalytics/query")) return res;
        const body = (await res.json()) as { rows: Array<{ keys: string[] }> };
        // Una fila de una fecha ajena a cualquier ventana, repetida en todas.
        body.rows.push({ keys: ["2026-01-01", "https://acme.test/fuera", "col", "MOBILE"], clicks: 1, impressions: 1, ctr: 1, position: 1 } as never);
        return json(body);
      };
      const r = await syncProjectSeoData(project.id, db, { ...deps(), fetchImpl: rare });
      expect(r.results[0]?.ok).toBe(true);
      expect(await count(s.seoSearchDaily, project.id)).toBe(180);
    });

    it("sincronizar un proyecto no toca los datos de otro", async () => {
      const a = await setup({ name: "Acme", connect: ["gsc"] });
      const client = await clients.createClient({ name: "Beta" }, db);
      const b = await projects.createProject(client.id, { name: "Otro", baseUrl: "https://beta.test" }, db);
      await db.insert(s.seoSearchDaily).values({ projectId: b.id, date: "2026-11-03", page: "/b", country: "col", device: "MOBILE", clicks: 7, impressions: 9, positionSum: 9 });
      await syncProjectSeoData(a.project.id, db, deps());
      expect(await count(s.seoSearchDaily, b.id)).toBe(1);
      expect(await count(s.seoSearchDaily, a.project.id)).toBe(180);
    });
  });

  describe("errores", () => {
    it("si GA4 falla, Search Console sigue y el error explica qué hacer", async () => {
      const { project } = await setup();
      fake.ga4Status = 403;
      const r = await syncProjectSeoData(project.id, db, deps());
      expect(r.results.find((x) => x.kind === "gsc")?.ok).toBe(true);
      const ga = r.results.find((x) => x.kind === "ga4")!;
      expect(ga.ok).toBe(false);
      expect(ga.detail).toContain(EMAIL);
      expect(ga.detail).toMatch(/rol Lector/);
      const row = await integration(project.id, "ga4");
      expect(row).toMatchObject({ syncStatus: "error", syncedThrough: null });
      expect(await count(s.seoTrafficDaily, project.id)).toBe(0);
      expect((await integration(project.id, "gsc")).syncStatus).toBe("ok");
    });

    it("un fallo a la mitad conserva lo ya descargado y se retoma desde ahí", async () => {
      const { project } = await setup({ connect: ["gsc"] });
      let n = 0;
      const flaky: typeof fetchImpl = async (url, init) => {
        // 400 no se reintenta: la tercera ventana falla de verdad y las dos primeras ya quedaron guardadas (cada ventana pide páginas y consultas: 2 peticiones).
        if (url.includes("searchAnalytics/query") && ++n >= 5) return json({ error: { message: "x" } }, 400);
        return fetchImpl(url, init);
      };
      const r = await syncProjectSeoData(project.id, db, { ...deps(), fetchImpl: flaky, sleep: async () => undefined });
      expect(r.results[0]?.ok).toBe(false);
      const half = await integration(project.id, "gsc");
      expect(half).toMatchObject({ syncStatus: "error", syncedThrough: "2026-10-08" });
      expect(await count(s.seoSearchDaily, project.id)).toBe(120);
      fake.calls = [];
      await syncProjectSeoData(project.id, db, deps());
      expect(fake.calls[0]).toEqual({ kind: "gsc", from: "2026-10-02", to: "2026-10-31" });
      expect(await count(s.seoSearchDaily, project.id)).toBe(180);
    });

    it("sin cuenta de servicio de Google lo dice en cada conexión y no descarga nada", async () => {
      const { project } = await setup();
      const r = await syncProjectSeoData(project.id, db, deps({ googleEnv: null }));
      expect(r.results.every((x) => !x.ok && /Falta la cuenta de servicio de Google en el worker/.test(x.detail))).toBe(true);
      // Dice dónde falta y qué definir, sin mandar a una pantalla que ya está configurada en el web.
      expect(r.results[0]!.detail).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
      expect(r.results[0]!.detail).toContain("AUTH_ENCRYPTION_KEY");
      expect(fake.calls).toHaveLength(0);
    });

    it("un valor inválido en la variable de entorno se explica", async () => {
      const { project } = await setup({ connect: ["gsc"] });
      const r = await syncProjectSeoData(project.id, db, deps({ googleEnv: "AIzaSyEjemploDeUnaClaveDeApi1234567890abcd" }));
      expect(r.results[0]?.detail).toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON no sirve/);
    });

    it("un proyecto sin conexiones a Google no hace nada, y uno inexistente responde «no encontrado»", async () => {
      const { project } = await setup({ connect: [] });
      expect(await syncProjectSeoData(project.id, db, deps())).toEqual({ projectId: project.id, results: [] });
      await expect(syncProjectSeoData("no-uuid", db, deps())).rejects.toThrow(/Proyecto no encontrado/);
    });

    it("no deja credenciales en lo que anota", async () => {
      const { project } = await setup();
      fake.ga4Status = 403;
      await syncProjectSeoData(project.id, db, deps());
      const text = JSON.stringify(await db.select().from(s.seoIntegrations));
      expect(text).not.toContain("PRIVATE KEY");
      expect(text).not.toContain("tok");
    });
  });

  describe("ronda diaria", () => {
    it("recorre los proyectos vigentes con conexión y salta los archivados y los que solo tienen Cloudflare", async () => {
      const a = await setup({ name: "Acme" });
      const b = await setup({ name: "Beta", connect: ["ga4"] });
      const archived = await setup({ name: "Gamma" });
      await db.update(s.projects).set({ deletedAt: new Date() }).where(eq(s.projects.id, archived.project.id));
      const cf = await setup({ name: "Delta", connect: [] });
      await saveConnection(cf.project.id, "cloudflare", { externalId: "a1".repeat(16), token: "cf-token-de-solo-lectura-0123456789" }, db, { key: KEY });

      const summary = await syncAllSeoData(db, deps());
      expect(summary).toEqual({ projects: 2, ok: 2, failed: 0 });
      expect(await count(s.seoSearchDaily, a.project.id)).toBe(180);
      expect(await count(s.seoTrafficDaily, b.project.id)).toBe(180);
      expect(await count(s.seoSearchDaily, archived.project.id)).toBe(0);
      expect(await count(s.seoSearchDaily, cf.project.id)).toBe(0);
    });

    it("cuenta los proyectos con error sin detener la ronda", async () => {
      await setup({ name: "Acme", connect: ["ga4"] });
      await setup({ name: "Beta", connect: ["ga4"] });
      fake.ga4Status = 500;
      expect(await syncAllSeoData(db, deps())).toEqual({ projects: 2, ok: 0, failed: 2 });
    });
  });

  describe("pedir una actualización desde el panel", () => {
    const online = () => writeHeartbeat(redis, { chrome: true });

    it("exige una conexión a Search Console o GA4", async () => {
      const { project } = await setup({ connect: [] });
      await online();
      await expect(requestSeoSync(project.id, { db, queue, redis })).rejects.toThrow(/Conecta Search Console o GA4/);
    });

    it("exige un worker en línea", async () => {
      const { project } = await setup();
      await expect(requestSeoSync(project.id, { db, queue, redis })).rejects.toThrow(/worker no está en línea/);
    });

    it("encola una sola vez por proyecto mientras haya una pendiente", async () => {
      const { project } = await setup();
      await online();
      expect(await requestSeoSync(project.id, { db, queue, redis })).toEqual({ queued: true });
      expect(await requestSeoSync(project.id, { db, queue, redis })).toEqual({ queued: false });
      const job = await queue.getJob(`seo-sync-manual-${project.id}`);
      expect(job?.name).toBe(SEO_SYNC_JOB);
      expect(job?.data).toEqual({ projectId: project.id });
      await expect(requestSeoSync("no-uuid", { db, queue, redis })).rejects.toThrow(/Proyecto no encontrado/);
    });
  });

  describe("worker", () => {
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
      AUDIT_COOLDOWN_MS: 60,
      AUDIT_TIMEOUT_MS: 5000,
      AUDIT_ATTEMPTS: 3,
      APP_URL: "http://localhost:3000",
      SMTP_PORT: 587,
    });
    const okRunner: LighthouseRunner = async () => ({ lhr: structuredClone(fixture) as never });
    const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
      const end = Date.now() + ms;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("tiempo de espera agotado");
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    it("registra la descarga diaria en la cola seo", async () => {
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: pino({ level: "silent" }), seoDeps: deps() });
      expect(await queue.getJobScheduler(SEO_SYNC_SCHEDULER_ID)).toMatchObject({ pattern: SEO_SYNC_CRON, tz: "UTC", name: SEO_SYNC_JOB });
    });

    it("ejecuta la actualización pedida a la cola y guarda lo que devuelve Google", async () => {
      const { project } = await setup();
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: pino({ level: "silent" }), seoDeps: deps() });
      await queue.add(SEO_SYNC_JOB, { projectId: project.id }, { jobId: `seo-sync-manual-${project.id}`, removeOnComplete: true });
      await waitFor(async () => (await integration(project.id, "ga4")).syncStatus === "ok" && (await integration(project.id, "gsc")).syncStatus === "ok");
      expect(await count(s.seoSearchDaily, project.id)).toBe(180);
      expect(await count(s.seoTrafficDaily, project.id)).toBe(180);
    });

    it("la ronda diaria (sin proyecto) recorre todos", async () => {
      const a = await setup({ name: "Acme", connect: ["gsc"] });
      const b = await setup({ name: "Beta", connect: ["ga4"] });
      worker = await startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: pino({ level: "silent" }), seoDeps: deps() });
      await queue.add(SEO_SYNC_JOB, {}, { jobId: "seo-sync-ronda", removeOnComplete: true });
      await waitFor(async () => (await count(s.seoSearchDaily, a.project.id)) > 0 && (await count(s.seoTrafficDaily, b.project.id)) > 0);
    });
  });
});
