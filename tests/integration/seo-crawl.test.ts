import type { Queue } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
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
import { crawlJobId, SEO_CRAWL_CRON, SEO_CRAWL_JOB, SEO_CRAWL_SCHEDULER_ID, SEO_CRAWL_WEEKLY_JOB } from "@/server/queue/schedulers";
import * as repo from "@/server/repositories/seo-crawl";
import type { FetchHopFn } from "@/server/seo/crawler";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { addMarket } from "@/server/services/seo-markets";
import { reconcileCrawlRuns, requestCrawl, runCrawl, scheduleWeeklyCrawls } from "@/server/services/seo-crawl";
import type { LighthouseRunner } from "@/worker/lighthouse/runner";
import { startWorker, type RunningWorker } from "@/worker/start";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const BASE = "https://acme.test";

// ------------------------------------------------------------ sitio falso

type Spec = { status?: number; type?: string; body?: string; location?: string };
const html = (name: string, links: string[] = [], o: { lang?: string; title?: string | null; hreflang?: Array<[string, string]>; extra?: string } = {}) => {
  const title = o.title === undefined ? `Título correcto y descriptivo de la página ${name}` : o.title;
  return `<!doctype html><html lang="${o.lang ?? "es"}"><head>${title === null ? "" : `<title>${title}</title>`}<meta name="description" content="Descripción de ${name}"><link rel="canonical" href="${BASE}${name}">${(o.hreflang ?? []).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${BASE}${p}">`).join("")}${o.extra ?? ""}</head><body><h1>${name}</h1><p>${"texto de la página ".repeat(10)}</p>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;
};
const org = `<script type="application/ld+json">{"@type":"Organization","name":"Acme","url":"${BASE}"}</script>`;
const sitemap = (...paths: string[]) => `<urlset>${paths.map((p) => `<url><loc>${BASE}${p}</loc></url>`).join("")}</urlset>`;

function fakeSite(site: Record<string, Spec | string>) {
  const log: string[] = [];
  const hop: FetchHopFn = async (url) => {
    log.push(url);
    await Promise.resolve();
    const u = new URL(url);
    const key = u.protocol === "http:" ? `http:${u.pathname}` : u.pathname;
    const raw = site[key];
    if (raw === undefined) return { status: 404, url, contentType: "text/html", location: null, xRobotsTag: null, text: "", truncated: false };
    const spec: Spec = typeof raw === "string" ? { body: raw } : raw;
    return { status: spec.status ?? 200, url, contentType: spec.type ?? (u.pathname.endsWith(".xml") ? "application/xml" : u.pathname === "/robots.txt" ? "text/plain" : "text/html"), location: spec.location ?? null, xRobotsTag: null, text: spec.body ?? "", truncated: false };
  };
  return { hop, log, deps: { fetchHop: hop, sleep: async () => undefined, now: () => Date.now() } };
}

const healthy = () => ({
  "/robots.txt": `User-agent: *\nSitemap: ${BASE}/sitemap.xml\n`,
  "/sitemap.xml": sitemap("/", "/a", "/en"),
  "http:/": { status: 301, location: `${BASE}/` },
  "/": html("/", ["/a", "/en"], { extra: org, hreflang: [["es", "/"], ["en", "/en"], ["x-default", "/"]] }),
  "/a": html("/a", ["/"]),
  "/en": html("/en", ["/"], { lang: "en", hreflang: [["es", "/"], ["en", "/en"], ["x-default", "/"]] }),
});

describe.skipIf(!(dbUrl && redisUrl))("rastreo técnico: servicio y worker", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const redis = createRedis(redisUrl ?? "redis://localhost:6379");
  const queue = seoQueue(redis);
  let s3: FakeS3;
  let worker: RunningWorker | undefined;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
    s3 = await startFakeS3();
  });
  afterAll(async () => {
    await queue.close();
    redis.disconnect();
    await s3.close();
    await pool.end();
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await redis.del("aoc:worker:heartbeat");
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  async function setup(o: { name?: string; baseUrl?: string; phase?: "development" | "production"; markets?: boolean; connect?: boolean } = {}) {
    const client = await clients.createClient({ name: o.name ?? "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: o.baseUrl ?? BASE, phase: o.phase ?? "production" }, db);
    if (o.markets !== false) {
      await addMarket(project.id, { lang: "es", prefix: "", isDefault: true }, db);
      await addMarket(project.id, { lang: "en", prefix: "/en", isDefault: false }, db);
    }
    if (o.connect) await db.insert(s.seoIntegrations).values({ projectId: project.id, kind: "gsc", externalId: "acme.test", status: "ok" });
    return { client, project };
  }
  const queued = async (projectId: string) => (await repo.createRun(db, projectId, "manual")).id;
  const issuesOf = async (runId: string) => (await repo.listIssues(db, runId)).map((i) => `${i.code}|${i.page}`);

  describe("ejecución", () => {
    it("un sitio sano termina sin hallazgos y guarda sus páginas con idioma, enlaces entrantes y límites", async () => {
      const { project } = await setup();
      const site = fakeSite(healthy());
      const id = await queued(project.id);
      const r = await runCrawl(id, db, site.deps);
      expect(r).toMatchObject({ runId: id, status: "succeeded", outcome: "complete", pages: 3, issues: { error: 0, warning: 0, info: 0 }, detail: null });

      const run = (await repo.getRun(db, id))!;
      expect(run).toMatchObject({ status: "succeeded", outcome: "complete", pagesCrawled: 3, pagesDiscovered: 3, errors: 0, warnings: 0, infos: 0 });
      expect(run.requests).toBeGreaterThanOrEqual(site.log.length - 1);
      expect(run.limits).toMatchObject({ maxPages: 300, maxDepth: 3, concurrency: 2, pauseMs: 400 });
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.finishedAt).toBeInstanceOf(Date);

      const pages = await repo.listPages(db, id);
      expect(pages.map((p) => [p.path, p.lang, p.inlinks, p.inSitemap, p.status])).toEqual([["/", "es", 2, true, 200], ["/a", "es", 1, true, 200], ["/en", "en", 1, true, 200]]);
      expect(pages[0]).toMatchObject({ title: "Título correcto y descriptivo de la página /", h1Count: 1, canonical: "/", htmlLang: "es", jsonLdTypes: ["Organization"] });
      expect(pages[0]!.hreflang).toEqual([{ lang: "es", path: "/" }, { lang: "en", path: "/en" }, { lang: "x-default", path: "/" }]);
      expect(await issuesOf(id)).toEqual([]);
    });

    it("un sitio con problemas guarda los hallazgos con su idioma, página y evidencia", async () => {
      const { project } = await setup();
      const site = fakeSite({
        ...healthy(),
        "/sitemap.xml": sitemap("/", "/a", "/en", "/huerfana"),
        "/": html("/", ["/a", "/en", "/rota"], { extra: org, hreflang: [["es", "/"], ["en", "/en"], ["x-default", "/"]] }),
        "/a": html("/a", ["/"], { title: null }),
        "/en": html("/en", ["/"], { lang: "es", hreflang: [["en", "/en"]] }),
        "/huerfana": html("/huerfana"),
      });
      const id = await queued(project.id);
      const r = await runCrawl(id, db, site.deps);
      expect(r.status).toBe("succeeded");
      expect(await issuesOf(id)).toEqual([
        "broken_link|/rota",
        "hreflang_not_reciprocal|/",
        "lang_mismatch|/en",
        "title_missing|/a",
        "orphan_page|/huerfana",
      ].sort());
      const issues = await repo.listIssues(db, id);
      expect(issues.find((i) => i.code === "lang_mismatch")).toMatchObject({ lang: "en", severity: "error", evidence: { lang: "es", expected: "en" } });
      expect(issues.find((i) => i.code === "broken_link")?.evidence).toMatchObject({ count: 1, from: ["/"], status: 404 });
      expect(r.issues).toEqual({ error: 4, warning: 1, info: 0 });
      expect((await repo.getRun(db, id))).toMatchObject({ errors: 4, warnings: 1 });
    });

    it("un sitio de más de 300 páginas termina como parcial y lo dice", async () => {
      const { project } = await setup({ markets: false });
      const paths = Array.from({ length: 330 }, (_, i) => `/p${i}`);
      const site = fakeSite({ "/robots.txt": "", "/sitemap.xml": sitemap("/", ...paths), "/": html("/", [], { extra: org }), ...Object.fromEntries(paths.map((p) => [p, html(p, ["/"])])) });
      const id = await queued(project.id);
      const r = await runCrawl(id, db, site.deps);
      expect(r).toMatchObject({ status: "partial", outcome: "partial", pages: 300 });
      expect(await repo.getRun(db, id)).toMatchObject({ status: "partial", truncatedBy: "pages", pagesCrawled: 300, pagesDiscovered: 331 });
      expect(await repo.listPages(db, id)).toHaveLength(300);
      expect(await issuesOf(id)).not.toContain("orphan_page|/p5");
    }, 60_000);

    it("si el sitio pide sesión, no responde o bloquea, queda fallido con el motivo y sin páginas ni hallazgos", async () => {
      const cases: Array<[Record<string, Spec | string>, string, RegExp]> = [
        [{ "/robots.txt": "", "/": { status: 401 } }, "login_required", /iniciar sesión/],
        [{ "/robots.txt": "", "/": { status: 403 } }, "blocked_by_site", /PageSpeedAOC-SEO/],
        [{ "/robots.txt": "User-agent: *\nDisallow: /\n" }, "site_blocked", /prohíbe rastrear/],
      ];
      for (const [map, outcome, detail] of cases) {
        const { project } = await setup({ name: `P-${outcome}` });
        const id = await queued(project.id);
        const r = await runCrawl(id, db, fakeSite(map).deps);
        expect(r).toMatchObject({ status: "failed", outcome, pages: 0, issues: null });
        const run = (await repo.getRun(db, id))!;
        expect(run).toMatchObject({ status: "failed", outcome, errors: 0 });
        expect(run.detail).toMatch(detail);
        expect(await repo.listPages(db, id)).toEqual([]);
        expect(await repo.findActiveRun(db, project.id)).toBeNull();
      }
    });

    it("un error inesperado deja el rastreo fallido con un mensaje legible y libera al proyecto", async () => {
      const { project } = await setup();
      const id = await queued(project.id);
      const r = await runCrawl(id, db, { ...fakeSite(healthy()).deps, now: () => { throw new Error("boom con detalles internos"); } });
      expect(r).toMatchObject({ status: "failed", outcome: "error" });
      const run = (await repo.getRun(db, id))!;
      expect(run.status).toBe("failed");
      expect(run.detail).toMatch(/error inesperado/);
      expect(run.detail).not.toContain("boom");
      expect(await repo.findActiveRun(db, project.id)).toBeNull();
    });

    it("un proyecto archivado mientras esperaba falla con un mensaje claro", async () => {
      const { project } = await setup();
      const id = await queued(project.id);
      await db.update(s.projects).set({ deletedAt: new Date() }).where(eq(s.projects.id, project.id));
      const r = await runCrawl(id, db, fakeSite(healthy()).deps);
      expect(r.status).toBe("failed");
      expect((await repo.getRun(db, id))?.detail).toMatch(/ya no existe/);
    });

    it("ejecutar dos veces el mismo rastreo no duplica nada: la segunda se salta", async () => {
      const { project } = await setup();
      const id = await queued(project.id);
      const site = fakeSite(healthy());
      expect((await runCrawl(id, db, site.deps)).status).toBe("succeeded");
      const requests = site.log.length;
      const second = await runCrawl(id, db, site.deps);
      expect(second.status).toBe("skipped");
      // Saltarse el rastreo es no volver a molestar al sitio del cliente.
      expect(site.log.length).toBe(requests);
      expect(await repo.listPages(db, id)).toHaveLength(3);
      expect((await runCrawl("00000000-0000-4000-8000-000000000000", db, site.deps)).status).toBe("skipped");
      await expect(runCrawl("no-uuid", db, site.deps)).rejects.toThrow(/Rastreo no encontrado/);
    });

    it("si la reconciliación lo cerró mientras corría, no se pisa ni se guardan sus resultados", async () => {
      const { project } = await setup();
      const id = await queued(project.id);
      const inner = fakeSite(healthy());
      const hop: FetchHopFn = async (url, o) => {
        await repo.failRun(db, id, "Perdido por la reconciliación", "stale");
        return inner.hop(url, o);
      };
      const r = await runCrawl(id, db, { ...inner.deps, fetchHop: hop });
      expect(r.status).toBe("skipped");
      expect(await repo.getRun(db, id)).toMatchObject({ status: "failed", outcome: "stale" });
      expect(await repo.listPages(db, id)).toEqual([]);
    });

    it("siembra las rutas del proyecto salvo las que piden sesión, y no sale de sus hosts", async () => {
      const { project } = await setup();
      await db.insert(s.routes).values([
        { projectId: project.id, path: "/extra", url: `${BASE}/extra` },
        { projectId: project.id, path: "/privada", url: `${BASE}/privada`, requiresAuth: true },
      ]);
      const site = fakeSite({ ...healthy(), "/extra": html("/extra", ["https://otro.test/x"]), "/privada": html("/privada") });
      const id = await queued(project.id);
      await runCrawl(id, db, site.deps);
      expect((await repo.listPages(db, id)).map((p) => p.path)).toContain("/extra");
      expect(site.log.some((u) => u.endsWith("/privada") || u.includes("otro.test"))).toBe(false);
    });

    it("conserva el detalle de los últimos 12 rastreos y de los anteriores solo su fila", async () => {
      const { project } = await setup();
      const site = fakeSite(healthy());
      const ids: string[] = [];
      for (let i = 0; i < 14; i++) {
        const id = await queued(project.id);
        await db.update(s.seoCrawlRuns).set({ queuedAt: new Date(Date.now() - (20 - i) * 60_000) }).where(eq(s.seoCrawlRuns.id, id));
        await runCrawl(id, db, site.deps);
        ids.push(id);
      }
      for (const id of ids.slice(0, 2)) {
        expect(await repo.listPages(db, id)).toEqual([]);
        expect(await repo.getRun(db, id)).toMatchObject({ status: "succeeded", pagesCrawled: 3 });
      }
      for (const id of ids.slice(2)) expect(await repo.listPages(db, id)).toHaveLength(3);
    }, 60_000);
  });

  describe("pedir un rastreo desde el panel", () => {
    const online = () => writeHeartbeat(redis, { chrome: true });

    it("exige un proyecto existente y un worker en línea", async () => {
      const { project } = await setup();
      await expect(requestCrawl(project.id, { db, queue, redis })).rejects.toThrow(/worker no está en línea/);
      await online();
      await expect(requestCrawl("00000000-0000-4000-8000-000000000000", { db, queue, redis })).rejects.toThrow(/Proyecto no encontrado/);
      await expect(requestCrawl("no-uuid", { db, queue, redis })).rejects.toThrow(/Proyecto no encontrado/);
    });

    it("encola un trabajo con el rastreo y no encola otro mientras haya uno activo; sirve también para proyectos en desarrollo", async () => {
      const { project } = await setup({ phase: "development" });
      await online();
      const first = await requestCrawl(project.id, { db, queue, redis });
      expect(first.queued).toBe(true);
      const job = await queue.getJob(crawlJobId(first.runId!));
      expect(job?.name).toBe(SEO_CRAWL_JOB);
      expect(job?.data).toEqual({ runId: first.runId });
      expect(await repo.getRun(db, first.runId!)).toMatchObject({ status: "queued", trigger: "manual" });
      expect(await requestCrawl(project.id, { db, queue, redis })).toEqual({ queued: false, runId: first.runId });
      expect(await queue.getJobCounts("waiting")).toMatchObject({ waiting: 1 });
    });

    it("si no se puede encolar, el rastreo no queda bloqueando al proyecto", async () => {
      const { project } = await setup();
      await online();
      const broken = { add: async () => { throw new Error("redis caído"); } } as unknown as Queue;
      await expect(requestCrawl(project.id, { db, queue: broken, redis })).rejects.toThrow(/No se pudo pedir el rastreo/);
      expect(await repo.findActiveRun(db, project.id)).toBeNull();
      expect((await repo.listRuns(db, project.id, 1))[0]).toMatchObject({ status: "failed", outcome: "enqueue" });
      await expect(requestCrawl(project.id, { db, queue, redis })).resolves.toMatchObject({ queued: true });
    });
  });

  describe("ronda semanal", () => {
    it("encola un rastreo por cada proyecto en producción con conexión, y salta los que ya tienen uno activo", async () => {
      const a = await setup({ name: "Acme", connect: true });
      const b = await setup({ name: "Beta", connect: true });
      await setup({ name: "Dev", phase: "development", connect: true });
      await setup({ name: "Sin conexión" });
      await repo.createRun(db, b.project.id, "manual");
      expect(await scheduleWeeklyCrawls({ db, queue })).toEqual({ projects: 2, queued: 1, skipped: 1, failed: 0 });
      const run = (await repo.listRuns(db, a.project.id, 1))[0]!;
      expect(run).toMatchObject({ status: "queued", trigger: "scheduled" });
      expect((await queue.getJob(crawlJobId(run.id)))?.name).toBe(SEO_CRAWL_JOB);
      expect(await queue.getJobCounts("waiting")).toMatchObject({ waiting: 1 });
    });

    it("un proyecto que falla al encolar se cuenta y no detiene al resto", async () => {
      await setup({ name: "Acme", connect: true });
      await setup({ name: "Beta", connect: true });
      let calls = 0;
      const flaky = { add: async (...args: unknown[]) => { calls += 1; if (calls === 1) throw new Error("x"); return (queue.add as (...a: unknown[]) => Promise<unknown>)(...args); } } as unknown as Queue;
      expect(await scheduleWeeklyCrawls({ db, queue: flaky })).toEqual({ projects: 2, queued: 1, skipped: 0, failed: 1 });
    });
  });

  describe("reconciliación", () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

    it("cierra los rastreos perdidos y respeta los que siguen vivos o son recientes", async () => {
      const lostQueued = await setup({ name: "Cliente A" });
      const aliveQueued = await setup({ name: "Cliente B" });
      const freshQueued = await setup({ name: "Cliente C" });
      const lostRunning = await setup({ name: "Cliente D" });
      const freshRunning = await setup({ name: "Cliente E" });
      const mk = async (projectId: string, over: Partial<typeof s.seoCrawlRuns.$inferInsert>) => {
        const run = await repo.createRun(db, projectId, "manual");
        await db.update(s.seoCrawlRuns).set(over).where(eq(s.seoCrawlRuns.id, run.id));
        return run.id;
      };
      const a = await mk(lostQueued.project.id, { queuedAt: ago(30) });
      const b = await mk(aliveQueued.project.id, { queuedAt: ago(30) });
      await queue.add(SEO_CRAWL_JOB, { runId: b }, { jobId: crawlJobId(b), delay: 3_600_000 });
      const c = await mk(freshQueued.project.id, { queuedAt: ago(1) });
      const d = await mk(lostRunning.project.id, { status: "running", queuedAt: ago(120), startedAt: ago(90) });
      const e = await mk(freshRunning.project.id, { status: "running", queuedAt: ago(20), startedAt: ago(10) });

      expect(await reconcileCrawlRuns({ db, queue })).toEqual({ failed: 2 });
      const status = async (id: string) => (await repo.getRun(db, id))!;
      expect(await status(a)).toMatchObject({ status: "failed", outcome: "stale" });
      expect((await status(a)).detail).toMatch(/se perdió/);
      expect(await status(d)).toMatchObject({ status: "failed", outcome: "stale" });
      expect((await status(b)).status).toBe("queued");
      expect((await status(c)).status).toBe("queued");
      expect((await status(e)).status).toBe("running");
      // Idempotente.
      expect(await reconcileCrawlRuns({ db, queue })).toEqual({ failed: 0 });
    });
  });

  describe("worker", () => {
    const env = (): WorkerEnv => ({
      NODE_ENV: "test", LOG_LEVEL: "error", DATABASE_URL: dbUrl!, REDIS_URL: redisUrl!, R2_ENDPOINT: s3.url, R2_REGION: "auto", R2_BUCKET: "reportes",
      R2_ACCESS_KEY_ID: "ak", R2_SECRET_ACCESS_KEY: "sk", CHROME_PATH: undefined, AUDIT_COOLDOWN_MS: 60, AUDIT_TIMEOUT_MS: 5000, AUDIT_ATTEMPTS: 3,
      APP_URL: "http://localhost:3000", SMTP_PORT: 587,
    });
    const okRunner: LighthouseRunner = async () => ({ lhr: structuredClone(fixture) as never });
    const start = (site = fakeSite(healthy())) => startWorker({ env: env(), runner: okRunner, allowPrivate: true, logger: pino({ level: "silent" }), seoCrawlDeps: site.deps });
    const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
      const end = Date.now() + ms;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("tiempo de espera agotado");
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    it("registra la ronda semanal en la cola seo", async () => {
      worker = await start();
      expect(await queue.getJobScheduler(SEO_CRAWL_SCHEDULER_ID)).toMatchObject({ pattern: SEO_CRAWL_CRON, tz: "UTC", name: SEO_CRAWL_WEEKLY_JOB });
    });

    it("ejecuta el rastreo pedido desde el panel de punta a punta", async () => {
      const { project } = await setup();
      worker = await start();
      const r = await requestCrawl(project.id, { db, queue, redis });
      expect(r.queued).toBe(true);
      await waitFor(async () => (await repo.getRun(db, r.runId!))?.status === "succeeded");
      expect(await repo.listPages(db, r.runId!)).toHaveLength(3);
      expect(await issuesOf(r.runId!)).toEqual([]);
      // El proyecto queda libre para pedir otro.
      await expect(requestCrawl(project.id, { db, queue, redis })).resolves.toMatchObject({ queued: true });
    });

    it("la ronda semanal encola y ejecuta los rastreos de todos los proyectos elegibles", async () => {
      const a = await setup({ name: "Acme", connect: true });
      worker = await start();
      await queue.add(SEO_CRAWL_WEEKLY_JOB, {}, { jobId: "semanal-prueba", removeOnComplete: true });
      const run = await waitFor(async () => (await repo.listRuns(db, a.project.id, 1))[0]);
      expect(run.trigger).toBe("scheduled");
      await waitFor(async () => (await repo.getRun(db, run.id))?.status === "succeeded");
    });

    it("al arrancar, la reconciliación cierra un rastreo en cola cuyo trabajo ya no existe", async () => {
      const { project } = await setup();
      const run = await repo.createRun(db, project.id, "manual");
      await db.update(s.seoCrawlRuns).set({ queuedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(s.seoCrawlRuns.id, run.id));
      worker = await start();
      await waitFor(async () => (await repo.getRun(db, run.id))?.status === "failed");
      expect(await db.select({ n: sql<number>`count(*)::int` }).from(s.seoCrawlRuns).where(and(eq(s.seoCrawlRuns.projectId, project.id), eq(s.seoCrawlRuns.outcome, "stale")))).toEqual([{ n: 1 }]);
    });
  });
});
