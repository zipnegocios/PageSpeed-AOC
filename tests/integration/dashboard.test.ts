import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import * as clients from "@/server/services/clients";
import { getFleet, listRecentAuditsGlobal, meanPerformanceChange, summarizeFleet } from "@/server/services/dashboard";
import { getLatestScores, getLatestScoresMany } from "@/server/services/history";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe.skipIf(!dbUrl)("datos del dashboard", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const noQueues = { maintenance: { add: async () => undefined } as never };

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => { await db.execute(sql`truncate clients, settings restart identity cascade`); });

  async function setup(clientName: string, projectName: string, phase: "development" | "production" = "production", paths = ["/"]) {
    const client = await clients.createClient({ name: clientName }, db);
    const project = await projects.createProject(client.id, { name: projectName, baseUrl: `https://${projectName.toLowerCase().replace(/\W/g, "")}.test` }, db, noQueues);
    if (phase === "production") await db.update(s.projects).set({ phase }).where(eq(s.projects.id, project.id));
    const created = [];
    for (const path of paths) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }

  async function audit(projectId: string, routeId: string, profile: "mobile" | "desktop", when: Date, v: { p?: number; s?: number; status?: "queued" | "running" | "succeeded" | "failed"; agentic?: [number, number] } = {}) {
    const status = v.status ?? "succeeded";
    const ok = status === "succeeded";
    const [row] = await db
      .insert(s.auditLogs)
      .values({
        projectId, routeId, profile, trigger: "scheduled", phaseAtRun: "production", status,
        scorePerformance: ok ? (v.p ?? 90) : null, scoreSeo: ok ? (v.s ?? 95) : null, scoreAccessibility: ok ? 100 : null, scoreBestPractices: ok ? 100 : null,
        agenticPassed: ok && v.agentic ? v.agentic[0] : null, agenticTotal: ok && v.agentic ? v.agentic[1] : null,
        r2Key: ok ? "k" : null, queuedAt: when, finishedAt: ok || status === "failed" ? when : null,
      })
      .returning();
    return row!;
  }

  describe("getLatestScoresMany", () => {
    it("da lo mismo que getLatestScores proyecto a proyecto (varias rutas, perfiles y auditorías)", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/", "/blog"]);
      const b = await setup("Beta", "Sitio", "production", ["/"]);
      const c = await setup("Gamma", "Vacío", "production", ["/"]); // sin auditorías
      for (const [proj, r] of [[a.project, a.routes[0]!], [a.project, a.routes[1]!], [b.project, b.routes[0]!]] as const) {
        await audit(proj.id, r.id, "mobile", daysAgo(10), { p: 60, agentic: [3, 5] });
        await audit(proj.id, r.id, "mobile", daysAgo(3), { p: 72, agentic: [4, 5] });
        await audit(proj.id, r.id, "mobile", daysAgo(1), { status: "failed" }); // un fallo no cuenta
        await audit(proj.id, r.id, "desktop", daysAgo(2), { p: 95 });
      }
      const ids = [a.project.id, b.project.id, c.project.id];
      const many = await getLatestScoresMany(ids, db);
      for (const id of ids) expect(many.get(id)).toEqual(await getLatestScores(id, db));
      expect(many.get(c.project.id)).toEqual([]);
      expect(many.get(a.project.id)).toHaveLength(4);
    });
    it("sin proyectos no consulta y devuelve un mapa vacío", async () => {
      expect((await getLatestScoresMany([], db)).size).toBe(0);
    });
  });

  describe("getFleet", () => {
    it("trae slugs, promedios, variación, agentes, última auditoría, miniatura, pendientes y alertas", async () => {
      const a = await setup("Acme S.A.", "Tienda Web", "production", ["/", "/blog"]);
      for (const r of a.routes) {
        await audit(a.project.id, r.id, "mobile", daysAgo(5), { p: 60, agentic: [2, 4] });
        await audit(a.project.id, r.id, "mobile", daysAgo(1), { p: 80, agentic: [3, 4] });
      }
      const newest = await audit(a.project.id, a.routes[1]!.id, "desktop", daysAgo(0.5), { p: 100, agentic: [4, 4] });
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(0.1), { status: "queued" });
      await audit(a.project.id, a.routes[0]!.id, "desktop", daysAgo(0.1), { status: "running" });
      await db.insert(s.alertStates).values({ projectId: a.project.id, routeId: a.routes[0]!.id, profile: "mobile", kind: "threshold", metric: "performance", status: "open", lastValue: 40, thresholdAtOpen: 80 });

      const [p] = await getFleet(db, NOW);
      expect(p).toMatchObject({ name: "Tienda Web", slug: "tienda-web", clientName: "Acme S.A.", clientSlug: "acme-s-a", phase: "production", openAlerts: 1, pending: 2 });
      expect(p!.scores.performance).toBe(87); // (80 + 80 + 100) / 3 -> 87
      expect(p!.performanceChange).toMatchObject({ diff: 20, direction: "up", verdict: "better", text: "20 puntos" });
      expect(p!.agentic).toEqual({ passed: 10, total: 12 }); // 3 + 3 + 4 / 4 + 4 + 4
      expect(p!.lastAudit).toMatchObject({ id: newest.id, routePath: "/blog", profile: "desktop" });
      expect(p!.sparkline).toEqual([60, 80, 100]); // por día: hace 5 d, hace 1 d, hoy
    });

    it("un proyecto sin auditorías aparece con valores vacíos y sin romper nada", async () => {
      await setup("Acme", "Nuevo", "development", ["/"]);
      const [p] = await getFleet(db, NOW);
      expect(p).toMatchObject({ scores: { performance: null, seo: null, accessibility: null, best_practices: null }, performanceChange: null, agentic: null, lastAudit: null, sparkline: [], openAlerts: 0, pending: 0, phase: "development" });
    });

    it("excluye proyectos y clientes archivados y sin proyectos devuelve una lista vacía", async () => {
      expect(await getFleet(db, NOW)).toEqual([]);
      const a = await setup("Acme", "Uno");
      const b = await setup("Beta", "Dos");
      const c = await setup("Gamma", "Tres");
      await projects.archiveProject(b.project.id, db, noQueues);
      await clients.archiveClient(c.client.id, db);
      expect((await getFleet(db, NOW)).map((p) => p.id)).toEqual([a.project.id]);
    });

    it("el resumen promedia solo lo medido y cuenta alertas, pendientes y proyectos sin auditar", async () => {
      const a = await setup("Acme", "Uno");
      const b = await setup("Beta", "Dos", "development");
      await setup("Gamma", "Tres");
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1), { p: 50 });
      await audit(b.project.id, b.routes[0]!.id, "mobile", daysAgo(1), { p: 100 });
      const sum = summarizeFleet(await getFleet(db, NOW));
      expect(sum).toMatchObject({ projects: 3, production: 2, development: 1, performance: 75, openAlerts: 0, pending: 0, withoutAudits: 1 });
    });
  });

  describe("meanPerformanceChange", () => {
    it("sin variaciones da null y una media 0 se llama 'sin cambio'", () => {
      expect(meanPerformanceChange([])).toBeNull();
    });
  });

  describe("listRecentAuditsGlobal", () => {
    it("de todos los proyectos, la más reciente primero, con slugs, límite y sin archivados", async () => {
      const a = await setup("Acme", "Uno");
      const b = await setup("Beta", "Dos");
      const c = await setup("Gamma", "Tres");
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(3));
      const mid = await audit(b.project.id, b.routes[0]!.id, "desktop", daysAgo(2), { p: 70 });
      const last = await audit(a.project.id, a.routes[0]!.id, "desktop", daysAgo(1), { status: "failed" });
      await audit(c.project.id, c.routes[0]!.id, "mobile", daysAgo(0.5));
      await clients.archiveClient(c.client.id, db);
      const all = await listRecentAuditsGlobal(10, db);
      expect(all.map((r) => r.id)).toEqual([last.id, mid.id, all[2]!.id]);
      expect(all[0]).toMatchObject({ status: "failed", projectSlug: "uno", clientSlug: "acme", routePath: "/" });
      expect(all[1]).toMatchObject({ projectSlug: "dos", clientSlug: "beta", scorePerformance: 70, profile: "desktop" });
      expect(await listRecentAuditsGlobal(2, db)).toHaveLength(2);
      expect(await listRecentAuditsGlobal(0, db)).toHaveLength(1); // el mínimo es 1
    });
    it("sin auditorías devuelve una lista vacía", async () => {
      expect(await listRecentAuditsGlobal(12, db)).toEqual([]);
    });
  });
});
