import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { getSiblingAudits } from "@/server/services/audits";
import * as clients from "@/server/services/clients";
import { listRecentPagesGlobal } from "@/server/services/dashboard";
import { getLatestScores, getLatestScoresAllRoutes } from "@/server/services/history";
import { defaultProfile, getPageAudits } from "@/server/services/pages";
import { getPortalSiblings } from "@/server/services/portal";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe.skipIf(!dbUrl)("páginas con sus dos dispositivos", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const noQueues = { maintenance: { add: async () => undefined } as never };

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => { await db.execute(sql`truncate clients, settings restart identity cascade`); });

  async function setup(clientName: string, projectName: string, phase: "development" | "production" = "production", paths = ["/", "/contacto"]) {
    const client = await clients.createClient({ name: clientName }, db);
    const project = await projects.createProject(client.id, { name: projectName, baseUrl: `https://${projectName.toLowerCase().replace(/\W/g, "")}.test` }, db, noQueues);
    if (phase === "production") await db.update(s.projects).set({ phase }).where(eq(s.projects.id, project.id));
    const created = [];
    for (const path of paths) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }

  async function audit(projectId: string, routeId: string, profile: "mobile" | "desktop", when: Date, v: { p?: number; status?: "queued" | "running" | "succeeded" | "failed" } = {}) {
    const status = v.status ?? "succeeded";
    const ok = status === "succeeded";
    const [row] = await db
      .insert(s.auditLogs)
      .values({
        projectId, routeId, profile, trigger: "scheduled", phaseAtRun: "production", status,
        scorePerformance: ok ? (v.p ?? 90) : null, scoreSeo: ok ? 95 : null, scoreAccessibility: ok ? 100 : null, scoreBestPractices: ok ? 100 : null,
        r2Key: ok ? "k" : null, errorCode: status === "failed" ? "TIMEOUT" : null, queuedAt: when, finishedAt: ok || status === "failed" ? when : null,
      })
      .returning();
    return row!;
  }

  describe("getPageAudits", () => {
    it("una entrada por página con móvil y escritorio, la de inicio primero, y cada dispositivo con lo suyo", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/contacto", "/"]);
      const [contacto, inicio] = a.routes;
      await audit(a.project.id, inicio!.id, "mobile", daysAgo(3), { p: 60 });
      const m2 = await audit(a.project.id, inicio!.id, "mobile", daysAgo(1), { p: 72 });
      const d1 = await audit(a.project.id, inicio!.id, "desktop", daysAgo(1), { p: 95 });
      await audit(a.project.id, contacto!.id, "mobile", daysAgo(2), { p: 55 });
      const pages = await getPageAudits(a.project.id, {}, db);
      expect(pages.map((p) => p.route.path)).toEqual(["/", "/contacto"]);
      const home = pages[0]!;
      expect(home.mobile.latest).toMatchObject({ auditId: m2.id, scores: { performance: 72 } });
      expect(home.mobile.latest!.changes.performance).toMatchObject({ diff: 12, verdict: "better" });
      expect(home.mobile.recent.map((r) => r.id)).toEqual([m2.id, home.mobile.recent[1]!.id]);
      expect(home.desktop.latest).toMatchObject({ auditId: d1.id, scores: { performance: 95 } });
      expect(home.mobile.state).toBe("ok");
      const contact = pages[1]!;
      expect(contact.mobile.latest!.scores.performance).toBe(55);
      expect(contact.desktop).toMatchObject({ latest: null, recent: [], state: "none", pending: false });
    });

    it("estados: en curso, fallida (con la última correcta aún disponible) y sin auditorías", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/", "/contacto", "/vacia"]);
      const [inicio, contacto] = a.routes;
      await audit(a.project.id, inicio!.id, "mobile", daysAgo(2), { p: 80 });
      await audit(a.project.id, inicio!.id, "mobile", daysAgo(1), { status: "failed" });
      await audit(a.project.id, inicio!.id, "desktop", daysAgo(0.1), { status: "running" });
      await audit(a.project.id, contacto!.id, "desktop", daysAgo(1), { p: 90 });
      const [home, contact, empty] = await getPageAudits(a.project.id, {}, db);
      expect(home!.mobile).toMatchObject({ state: "failed", latest: { scores: { performance: 80 } } });
      expect(home!.desktop).toMatchObject({ state: "pending", pending: true, latest: null });
      expect(contact!.desktop.state).toBe("ok");
      expect(contact!.mobile.state).toBe("none");
      expect(empty!.route.path).toBe("/vacia");
      expect(empty!.mobile.state).toBe("none");
    });

    it("incluye rutas ad hoc con auditorías, deja fuera las no monitoreadas sin ellas y respeta el límite de 'recientes'", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/", "/oculta", "/ad-hoc"]);
      const [inicio, oculta, adhoc] = a.routes;
      await routes.setRouteMonitored(oculta!.id, false, db);
      await routes.setRouteMonitored(adhoc!.id, false, db);
      for (let i = 0; i < 8; i++) await audit(a.project.id, inicio!.id, "mobile", daysAgo(10 - i));
      await audit(a.project.id, adhoc!.id, "desktop", daysAgo(1), { p: 70 });
      const pages = await getPageAudits(a.project.id, { recent: 3 }, db);
      expect(pages.map((p) => p.route.path)).toEqual(["/", "/ad-hoc"]);
      expect(pages[0]!.mobile.recent).toHaveLength(3);
      expect(pages[1]!.desktop.latest!.scores.performance).toBe(70); // ad hoc: no monitoreada, pero con datos
    });

    it("no mezcla proyectos y un proyecto sin rutas da una lista vacía", async () => {
      const a = await setup("Acme", "Uno", "production", ["/"]);
      const b = await setup("Beta", "Dos", "production", ["/"]);
      const c = await setup("Gamma", "Tres", "production", []);
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1));
      expect((await getPageAudits(b.project.id, {}, db))[0]!.mobile.recent).toEqual([]);
      expect(await getPageAudits(c.project.id, {}, db)).toEqual([]);
    });

    it("el dispositivo inicial es el de la auditoría más reciente (a igualdad, móvil)", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/", "/contacto", "/blog"]);
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(3));
      await audit(a.project.id, a.routes[0]!.id, "desktop", daysAgo(1));
      await audit(a.project.id, a.routes[1]!.id, "mobile", daysAgo(1));
      await audit(a.project.id, a.routes[1]!.id, "desktop", daysAgo(5));
      const [home, contact, blog] = await getPageAudits(a.project.id, {}, db);
      expect(defaultProfile(home!)).toBe("desktop");
      expect(defaultProfile(contact!)).toBe("mobile");
      expect(defaultProfile(blog!)).toBe("mobile");
    });
  });

  describe("getLatestScoresAllRoutes", () => {
    it("coincide con getLatestScores cuando todas las rutas están monitoreadas y añade las no monitoreadas", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/", "/blog"]);
      for (const r of a.routes) {
        await audit(a.project.id, r.id, "mobile", daysAgo(3), { p: 60 });
        await audit(a.project.id, r.id, "mobile", daysAgo(1), { p: 80 });
      }
      expect(await getLatestScoresAllRoutes(a.project.id, db)).toEqual(await getLatestScores(a.project.id, db));
      await routes.setRouteMonitored(a.routes[1]!.id, false, db);
      expect(await getLatestScores(a.project.id, db)).toHaveLength(1);
      expect(await getLatestScoresAllRoutes(a.project.id, db)).toHaveLength(2);
    });
  });

  describe("getSiblingAudits", () => {
    it("devuelve la última correcta de cada dispositivo de la MISMA ruta, ignorando fallidas y otras rutas", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/", "/contacto"]);
      const [inicio, contacto] = a.routes;
      const m1 = await audit(a.project.id, inicio!.id, "mobile", daysAgo(3), { p: 60 });
      const m2 = await audit(a.project.id, inicio!.id, "mobile", daysAgo(2), { p: 70 });
      await audit(a.project.id, inicio!.id, "mobile", daysAgo(1), { status: "failed" });
      await audit(a.project.id, contacto!.id, "desktop", daysAgo(0.5), { p: 99 }); // otra ruta: no cuenta
      const sib = await getSiblingAudits(m1.id, db);
      expect(sib.mobile).toMatchObject({ id: m2.id, scorePerformance: 70 });
      expect(sib.desktop).toBeNull();
      const d = await audit(a.project.id, inicio!.id, "desktop", daysAgo(1), { p: 91 });
      expect((await getSiblingAudits(m2.id, db)).desktop).toMatchObject({ id: d.id, scorePerformance: 91 });
      await expect(getSiblingAudits("00000000-0000-4000-8000-000000000000", db)).rejects.toThrow(/no encontrada/);
    });
  });

  describe("getPortalSiblings", () => {
    it("solo para auditorías correctas de proyectos del propio cliente (en producción o en desarrollo)", async () => {
      const a = await setup("Acme", "Tienda", "production", ["/"]);
      const b = await setup("Beta", "Otro", "production", ["/"]);
      const dev = await setup("Gamma", "Dev", "development", ["/"]);
      const m = await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(2), { p: 70 });
      const d = await audit(a.project.id, a.routes[0]!.id, "desktop", daysAgo(1), { p: 90 });
      const failed = await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(0.5), { status: "failed" });
      const devAudit = await audit(dev.project.id, dev.routes[0]!.id, "mobile", daysAgo(1));
      const ok = await getPortalSiblings(a.client.id, a.project.slug, m.id, db);
      expect(ok).toMatchObject({ mobile: { id: m.id }, desktop: { id: d.id } });
      expect(await getPortalSiblings(a.client.id, a.project.id, m.id, db)).not.toBeNull(); // también por UUID
      expect(await getPortalSiblings(b.client.id, a.project.slug, m.id, db)).toBeNull(); // proyecto de otro cliente
      expect(await getPortalSiblings(a.client.id, a.project.slug, failed.id, db)).toBeNull(); // auditoría no correcta
      expect(await getPortalSiblings(dev.client.id, dev.project.slug, devAudit.id, db)).not.toBeNull(); // el cliente también ve su proyecto en desarrollo
      expect(await getPortalSiblings(a.client.id, dev.project.slug, devAudit.id, db)).toBeNull(); // pero no el de otro cliente
      expect(await getPortalSiblings(a.client.id, a.project.slug, "no-es-uuid", db)).toBeNull();
    });
  });

  describe("listRecentPagesGlobal", () => {
    it("una entrada por página con sus dos dispositivos, la actividad más reciente primero y sin archivados", async () => {
      const a = await setup("Acme", "Uno", "production", ["/", "/contacto"]);
      const b = await setup("Beta", "Dos", "production", ["/"]);
      const c = await setup("Gamma", "Tres", "production", ["/"]);
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(5));
      const aD = await audit(a.project.id, a.routes[0]!.id, "desktop", daysAgo(4), { p: 88 });
      await audit(a.project.id, a.routes[1]!.id, "mobile", daysAgo(3), { p: 61 });
      const bM = await audit(b.project.id, b.routes[0]!.id, "mobile", daysAgo(1), { p: 77 });
      await audit(c.project.id, c.routes[0]!.id, "mobile", daysAgo(0.5));
      await clients.archiveClient(c.client.id, db);
      const feed = await listRecentPagesGlobal(10, db);
      expect(feed.map((e) => `${e.projectName}${e.routePath}`)).toEqual(["Dos/", "Uno/contacto", "Uno/"]);
      expect(feed[0]).toMatchObject({ clientSlug: "beta", projectSlug: "dos", mobile: { id: bM.id }, desktop: null });
      const home = feed[2]!;
      expect(home.mobile).not.toBeNull();
      expect(home.desktop).toMatchObject({ id: aD.id, scorePerformance: 88 });
      expect((await listRecentPagesGlobal(2, db))).toHaveLength(2);
    });
    it("sin auditorías devuelve una lista vacía", async () => {
      expect(await listRecentPagesGlobal(10, db)).toEqual([]);
    });
  });
});
