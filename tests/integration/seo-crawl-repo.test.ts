import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { PageRow } from "@/server/domain/seo-crawl-rows";
import type { Issue } from "@/server/domain/seo-crawl-rules";
import * as repo from "@/server/repositories/seo-crawl";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { isUniqueViolation } from "@/server/services/shared";

const dbUrl = process.env.TEST_DATABASE_URL;

const page = (path: string, over: Partial<PageRow> = {}): PageRow => ({
  path, status: 200, finalPath: null, hops: 0, loop: false, contentType: "text/html", blockedByRobots: false, inSitemap: true, lang: "es",
  title: "Título", descriptionLength: 100, h1Count: 1, canonical: path, htmlLang: "es", robots: null, hreflang: null, jsonLdTypes: null, inlinks: 0, ...over,
});
const issue = (code: Issue["code"], pg: string, severity: Issue["severity"], evidence: Issue["evidence"] = {}): Issue => ({ code, page: pg, severity, lang: null, evidence });
const OK = { status: "succeeded" as const, outcome: "complete", detail: null, pagesCrawled: 2, pagesDiscovered: 3, requests: 8, truncatedBy: null };

describe.skipIf(!dbUrl)("datos del rastreo técnico (SEO)", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let a: string;
  let b: string;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    const client = await clients.createClient({ name: "Acme" }, db);
    a = (await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db)).id;
    b = (await projects.createProject(client.id, { name: "Blog", baseUrl: "https://blog.acme.test" }, db)).id;
  });

  /** Un rastreo terminado, con tiempo de cola controlado para fijar el orden. */
  async function finished(projectId: string, minutesAgo: number, status: "succeeded" | "partial" | "failed" = "succeeded", pages: PageRow[] = [page("/")], issues: Issue[] = [issue("h1_missing", "/", "warning")]) {
    const run = await repo.createRun(db, projectId, "scheduled");
    await db.update(s.seoCrawlRuns).set({ queuedAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(s.seoCrawlRuns.id, run.id));
    await repo.markRunning(db, run.id, { maxPages: 300 });
    await repo.finishRun(db, run.id, { ...OK, status, outcome: status === "failed" ? "unreachable" : "complete" }, pages, issues);
    return run.id;
  }

  describe("un rastreo activo por proyecto", () => {
    it("no deja crear un segundo mientras hay uno en cola o en curso, pero sí en otro proyecto", async () => {
      const first = await repo.createRun(db, a, "manual");
      expect(first).toMatchObject({ status: "queued", trigger: "manual", pagesCrawled: 0, errors: 0 });
      await expect(repo.createRun(db, a, "scheduled")).rejects.toSatisfy(isUniqueViolation);
      await repo.markRunning(db, first.id, {});
      await expect(repo.createRun(db, a, "scheduled")).rejects.toSatisfy(isUniqueViolation);
      await expect(repo.createRun(db, b, "manual")).resolves.toBeTruthy();
      expect((await repo.findActiveRun(db, a))?.id).toBe(first.id);
    });

    it("al terminar o fallar, el proyecto queda libre para otro", async () => {
      const first = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, first.id, {});
      await repo.finishRun(db, first.id, OK, [page("/")], []);
      expect(await repo.findActiveRun(db, a)).toBeNull();
      const second = await repo.createRun(db, a, "manual");
      expect(await repo.failRun(db, second.id, "se cayó")).toBe(true);
      await expect(repo.createRun(db, a, "manual")).resolves.toBeTruthy();
    });

    it("proyectos con rastreo activo, para el agendador", async () => {
      await repo.createRun(db, a, "manual");
      expect(await repo.projectsWithActiveRun(db, [a, b])).toEqual(new Set([a]));
      expect(await repo.projectsWithActiveRun(db, [])).toEqual(new Set());
    });
  });

  describe("cierre del rastreo", () => {
    it("solo pasa de en cola a en curso una vez", async () => {
      const run = await repo.createRun(db, a, "manual");
      expect(await repo.markRunning(db, run.id, { maxPages: 300, pauseMs: 400 })).toBe(true);
      expect(await repo.markRunning(db, run.id, {})).toBe(false);
      const row = (await repo.getRun(db, run.id))!;
      expect(row.status).toBe("running");
      expect(row.startedAt).toBeInstanceOf(Date);
      expect(row.limits).toEqual({ maxPages: 300, pauseMs: 400 });
    });

    it("guarda páginas, hallazgos y conteos por gravedad, y devuelve lo mismo que se guardó", async () => {
      const run = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, run.id, {});
      const pages = [
        page("/", { robots: ["noarchive"], hreflang: [{ lang: "es", path: "/" }, { lang: "en", path: "/en" }], jsonLdTypes: ["Organization"], inlinks: 3, title: "Título con ñ y «comillas»" }),
        page("/rota", { status: 404, title: null, descriptionLength: null, h1Count: null, canonical: null, htmlLang: null }),
      ];
      const issues = [
        issue("status_error", "/rota", "error", { status: 404, inSitemap: true, from: ["/", "/a"] }),
        issue("robots_missing", "", "warning"),
        issue("title_length", "/", "warning", { length: 12 }),
        issue("client_rendered", "/x", "info"),
      ];
      expect(await repo.finishRun(db, run.id, { ...OK, pagesCrawled: 2 }, pages, issues)).toBe(true);

      const row = (await repo.getRun(db, run.id))!;
      expect(row).toMatchObject({ status: "succeeded", outcome: "complete", pagesCrawled: 2, pagesDiscovered: 3, requests: 8, errors: 1, warnings: 2, infos: 1 });
      expect(row.finishedAt).toBeInstanceOf(Date);
      expect(await repo.listPages(db, run.id)).toEqual(pages.map((p) => ({ runId: run.id, ...p })).sort((x, y) => x.path.localeCompare(y.path)));
      const got = await repo.listIssues(db, run.id);
      expect(got.map((i) => `${i.code}|${i.page}`)).toEqual(["client_rendered|/x", "robots_missing|", "status_error|/rota", "title_length|/"]);
      expect(got.find((i) => i.code === "status_error")?.evidence).toEqual({ status: 404, inSitemap: true, from: ["/", "/a"] });
      expect(got.find((i) => i.code === "robots_missing")?.evidence).toEqual({});
    });

    it("un rastreo fallido no guarda páginas ni hallazgos aunque se los pasen", async () => {
      const run = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, run.id, {});
      await repo.finishRun(db, run.id, { ...OK, status: "failed", outcome: "blocked_by_site", detail: "Un cortafuegos lo frena", pagesCrawled: 0 }, [page("/")], [issue("h1_missing", "/", "warning")]);
      const row = (await repo.getRun(db, run.id))!;
      expect(row).toMatchObject({ status: "failed", outcome: "blocked_by_site", detail: "Un cortafuegos lo frena", errors: 0, warnings: 0 });
      expect(await repo.listPages(db, run.id)).toEqual([]);
      expect(await repo.listIssues(db, run.id)).toEqual([]);
    });

    it("un rastreo parcial guarda lo que hay y dice por qué se cortó", async () => {
      const run = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, run.id, {});
      await repo.finishRun(db, run.id, { ...OK, status: "partial", outcome: "partial", truncatedBy: "pages", detail: "Se alcanzó el máximo de 300 páginas" }, [page("/")], []);
      expect(await repo.getRun(db, run.id)).toMatchObject({ status: "partial", truncatedBy: "pages" });
      expect(await repo.listPages(db, run.id)).toHaveLength(1);
    });

    it("es atómico: si falla una fila, no queda nada a medias y el rastreo sigue en curso", async () => {
      const run = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, run.id, {});
      await expect(repo.finishRun(db, run.id, OK, [page("/"), page("/")], [])).rejects.toSatisfy(isUniqueViolation);
      expect(await repo.listPages(db, run.id)).toEqual([]);
      expect((await repo.getRun(db, run.id))?.status).toBe("running");
    });

    it("no reescribe un rastreo que ya estaba cerrado (por ejemplo, por la reconciliación)", async () => {
      const run = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, run.id, {});
      expect(await repo.failRun(db, run.id, "Perdido")).toBe(true);
      expect(await repo.finishRun(db, run.id, OK, [page("/")], [])).toBe(false);
      expect((await repo.getRun(db, run.id))).toMatchObject({ status: "failed", detail: "Perdido" });
      expect(await repo.listPages(db, run.id)).toEqual([]);
      // Fallar no toca uno terminado.
      const done = await finished(b, 5);
      expect(await repo.failRun(db, done, "No debe")).toBe(false);
      expect((await repo.getRun(db, done))?.status).toBe("succeeded");
    });

    it("guarda cientos de páginas y hallazgos (lotes)", async () => {
      const run = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, run.id, {});
      const pages = Array.from({ length: 1200 }, (_, i) => page(`/p${i}`));
      const issues = Array.from({ length: 1200 }, (_, i) => issue("h1_missing", `/p${i}`, "warning"));
      await repo.finishRun(db, run.id, { ...OK, pagesCrawled: 1200 }, pages, issues);
      expect(await repo.listPages(db, run.id)).toHaveLength(1200);
      expect((await repo.getRun(db, run.id))?.warnings).toBe(1200);
    });
  });

  describe("lectura", () => {
    it("lista los rastreos del más reciente al más antiguo; los terminados excluyen en cola, en curso y fallidos", async () => {
      const old = await finished(a, 300);
      const failed = await finished(a, 200, "failed");
      const partial = await finished(a, 100, "partial");
      const active = await repo.createRun(db, a, "manual");
      expect((await repo.listRuns(db, a, 10)).map((r) => r.id)).toEqual([active.id, partial, failed, old]);
      expect((await repo.listRuns(db, a, 2)).map((r) => r.id)).toEqual([active.id, partial]);
      expect((await repo.listFinishedRuns(db, a, 10)).map((r) => r.id)).toEqual([partial, old]);
      expect(await repo.listFinishedRuns(db, b, 10)).toEqual([]);
    });
  });

  describe("retención", () => {
    it("conserva páginas y hallazgos de los últimos N rastreos y deja de los anteriores solo su fila con conteos", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(await finished(a, 500 - i * 100));
      const otherProject = await finished(b, 900);
      expect(await repo.pruneRuns(db, a, 3)).toBe(2);
      for (const id of ids.slice(0, 2)) {
        expect(await repo.listPages(db, id)).toEqual([]);
        expect(await repo.listIssues(db, id)).toEqual([]);
        expect(await repo.getRun(db, id)).toMatchObject({ status: "succeeded", warnings: 1 });
      }
      for (const id of ids.slice(2)) {
        expect(await repo.listPages(db, id)).toHaveLength(1);
        expect(await repo.listIssues(db, id)).toHaveLength(1);
      }
      // Otro proyecto, aunque sea más antiguo, no se toca; y repetir no hace nada.
      expect(await repo.listPages(db, otherProject)).toHaveLength(1);
      expect(await repo.pruneRuns(db, a, 3)).toBe(0);
      expect(await repo.pruneRuns(db, b, 3)).toBe(0);
    });

    it("los rastreos fallidos y los activos no cuentan para el cupo ni se podan", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push(await finished(a, 600 - i * 100));
      await finished(a, 50, "failed");
      const active = await repo.createRun(db, a, "manual");
      expect(await repo.pruneRuns(db, a, 3)).toBe(0);
      expect(await repo.pruneRuns(db, a, 2)).toBe(1);
      expect(await repo.listPages(db, ids[0]!)).toEqual([]);
      expect((await repo.getRun(db, active.id))?.status).toBe("queued");
    });
  });

  describe("rastreos perdidos", () => {
    it("marca como fallidos los que llevan demasiado en curso o en cola, y deja los recientes y los terminados", async () => {
      const longAgo = new Date(Date.now() - 3 * 3_600_000);
      const done = await finished(a, 400);
      const running = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, running.id, {});
      await db.update(s.seoCrawlRuns).set({ startedAt: longAgo }).where(eq(s.seoCrawlRuns.id, running.id));
      const queued = await repo.createRun(db, b, "manual");
      await db.update(s.seoCrawlRuns).set({ queuedAt: longAgo }).where(eq(s.seoCrawlRuns.id, queued.id));

      const cut = new Date(Date.now() - 45 * 60_000);
      expect(await repo.failStaleRuns(db, cut, cut, "El rastreo se perdió")).toBe(2);
      expect(await repo.getRun(db, running.id)).toMatchObject({ status: "failed", outcome: "stale", detail: "El rastreo se perdió" });
      expect((await repo.getRun(db, queued.id))?.status).toBe("failed");
      expect((await repo.getRun(db, done))?.status).toBe("succeeded");

      // Uno reciente no se toca.
      const fresh = await repo.createRun(db, a, "manual");
      await repo.markRunning(db, fresh.id, {});
      expect(await repo.failStaleRuns(db, cut, cut, "x")).toBe(0);
      expect((await repo.getRun(db, fresh.id))?.status).toBe("running");
    });
  });

  describe("borrado", () => {
    it("al borrar el proyecto se van sus rastreos, páginas y hallazgos", async () => {
      const id = await finished(a, 10);
      const keep = await finished(b, 10);
      await db.delete(s.projects).where(eq(s.projects.id, a));
      expect(await repo.getRun(db, id)).toBeNull();
      expect(await db.select().from(s.seoCrawlPages).where(eq(s.seoCrawlPages.runId, id))).toEqual([]);
      expect(await db.select().from(s.seoCrawlIssues).where(eq(s.seoCrawlIssues.runId, id))).toEqual([]);
      expect(await repo.listPages(db, keep)).toHaveLength(1);
    });

    it("rechaza gravedades y estados que no existen", async () => {
      const run = await repo.createRun(db, a, "manual");
      await expect(db.execute(sql`insert into seo_crawl_issues (run_id, page, code, severity) values (${run.id}, '/', 'x', 'grave')`)).rejects.toThrow();
      await expect(db.execute(sql`update seo_crawl_runs set status = 'raro' where id = ${run.id}`)).rejects.toThrow();
    });
  });
});
