import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { isDomainError } from "@/server/domain/errors";
import * as alerts from "@/server/services/alerts";
import * as clients from "@/server/services/clients";
import { averageScores, getLatestScores, getSeries } from "@/server/services/history";
import * as portal from "@/server/services/portal";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import * as thresholds from "@/server/services/thresholds";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const NOW = new Date("2026-04-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe.skipIf(!dbUrl)("histórico y portal del cliente", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });

  async function setup(name = "Acme", phase: "development" | "production" = "production", paths = ["/"]) {
    const client = await clients.createClient({ name }, db);
    const project = await projects.createProject(client.id, { name: `Sitio ${name}`, baseUrl: "https://acme.test" }, db);
    if (phase === "production") await db.update(s.projects).set({ phase }).where(eq(s.projects.id, project.id));
    const created = [];
    for (const path of paths) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }

  async function audit(
    projectId: string,
    routeId: string,
    profile: "mobile" | "desktop",
    when: Date,
    v: { p?: number; s?: number; a?: number; b?: number; lcp?: number; tbt?: number; cls?: string; status?: "succeeded" | "failed" } = {},
  ) {
    const failed = v.status === "failed";
    const [row] = await db
      .insert(s.auditLogs)
      .values({
        projectId, routeId, profile, trigger: "scheduled", phaseAtRun: "production",
        status: v.status ?? "succeeded",
        scorePerformance: failed ? null : (v.p ?? 90), scoreSeo: failed ? null : (v.s ?? 95),
        scoreAccessibility: failed ? null : (v.a ?? 100), scoreBestPractices: failed ? null : (v.b ?? 100),
        lcpMs: failed ? null : (v.lcp ?? 2000), tbtMs: failed ? null : (v.tbt ?? 100), cls: failed ? null : (v.cls ?? "0.01"),
        r2Key: failed ? null : "k", queuedAt: when, finishedAt: when,
      })
      .returning();
    return row!;
  }

  describe("resolvePortal", () => {
    it("un token vigente da acceso; uno mal formado o desconocido, no", async () => {
      const { client } = await setup();
      const c = await clients.getClient(client.id, db);
      expect(await portal.resolvePortal(c.magicToken, db)).toEqual({ state: "ok", client: { id: client.id, name: "Acme" } });
      expect(await portal.resolvePortal("corto", db)).toEqual({ state: "invalid" });
      expect(await portal.resolvePortal("x".repeat(43), db)).toEqual({ state: "invalid" });
      expect(await portal.resolvePortal("../".repeat(20), db)).toEqual({ state: "invalid" });
      expect(await portal.resolvePortal("", db)).toEqual({ state: "invalid" });
    });

    it("suspender corta el acceso al instante y reactivar lo devuelve", async () => {
      const { client } = await setup();
      const { magicToken } = await clients.getClient(client.id, db);
      await clients.setClientStatus(client.id, "suspended", db);
      expect(await portal.resolvePortal(magicToken, db)).toEqual({ state: "suspended", clientName: "Acme" });
      await clients.setClientStatus(client.id, "active", db);
      expect((await portal.resolvePortal(magicToken, db)).state).toBe("ok");
    });

    it("rotar el token invalida el anterior", async () => {
      const { client } = await setup();
      const old = (await clients.getClient(client.id, db)).magicToken;
      const fresh = (await clients.rotateMagicToken(client.id, db)).magicToken;
      expect(fresh).not.toBe(old);
      expect((await portal.resolvePortal(old, db)).state).toBe("invalid");
      expect((await portal.resolvePortal(fresh, db)).state).toBe("ok");
    });

    it("un cliente archivado ya no entra", async () => {
      const { client } = await setup();
      const { magicToken } = await clients.getClient(client.id, db);
      await clients.archiveClient(client.id, db);
      expect((await portal.resolvePortal(magicToken, db)).state).toBe("invalid");
    });
  });

  describe("getLatestScores", () => {
    it("toma la última auditoría correcta por ruta y perfil y la variación frente a la anterior", async () => {
      const { project, routes: [r] } = await setup();
      await audit(project.id, r!.id, "mobile", daysAgo(14), { p: 60, lcp: 4000 });
      await audit(project.id, r!.id, "mobile", daysAgo(7), { p: 72, lcp: 3000 });
      await audit(project.id, r!.id, "mobile", daysAgo(1), { p: 61, lcp: 3500, status: "failed" }); // un fallo no cuenta
      await audit(project.id, r!.id, "desktop", daysAgo(2), { p: 99 });

      const rows = await getLatestScores(project.id, db);
      const mobile = rows.find((x) => x.profile === "mobile")!;
      expect(mobile.scores.performance).toBe(72);
      expect(mobile.changes.performance).toMatchObject({ diff: 12, verdict: "better", text: "12 puntos" });
      expect(mobile.changes.seo).toMatchObject({ verdict: "same" });
      const desktop = rows.find((x) => x.profile === "desktop")!;
      expect(desktop.scores.performance).toBe(99);
      expect(desktop.changes.performance).toBeNull(); // sin auditoría anterior
    });

    it("ignora rutas no monitoreadas y promedia entre rutas y perfiles", async () => {
      const { project, routes: [a, b] } = await setup("Acme", "production", ["/", "/blog"]);
      await db.update(s.routes).set({ monitored: false }).where(eq(s.routes.id, b!.id));
      await audit(project.id, a!.id, "mobile", daysAgo(1), { p: 70 });
      await audit(project.id, a!.id, "desktop", daysAgo(1), { p: 90 });
      await audit(project.id, b!.id, "mobile", daysAgo(1), { p: 10 });
      const rows = await getLatestScores(project.id, db);
      expect(rows.map((x) => x.path)).toEqual(["/", "/"]);
      expect(averageScores(rows).performance).toBe(80);
    });
  });

  describe("getSeries", () => {
    it("devuelve la serie ordenada del periodo y perfil pedidos", async () => {
      const { project, routes: [r] } = await setup();
      await audit(project.id, r!.id, "mobile", daysAgo(40), { p: 50 }); // fuera de 30 días
      await audit(project.id, r!.id, "mobile", daysAgo(10), { p: 70 });
      await audit(project.id, r!.id, "mobile", daysAgo(20), { p: 60 });
      await audit(project.id, r!.id, "desktop", daysAgo(5), { p: 99 }); // otro perfil
      await audit(project.id, r!.id, "mobile", daysAgo(2), { p: 80, status: "failed" }); // fallo
      const out = await getSeries({ projectId: project.id, routeId: r!.id, profile: "mobile", metric: "performance", days: 30 }, db, NOW);
      expect(out.points.map((p) => p.value)).toEqual([60, 70]);
      expect(out.points[0]!.at.getTime()).toBeLessThan(out.points[1]!.at.getTime());
      expect(out.from.getTime()).toBe(daysAgo(30).getTime());
      const wide = await getSeries({ projectId: project.id, routeId: r!.id, profile: "mobile", metric: "performance", days: 90 }, db, NOW);
      expect(wide.points.map((p) => p.value)).toEqual([50, 60, 70]);
    });

    it("lee tiempos y CLS, y la meta solo existe en puntuaciones con alerta activa", async () => {
      const { project, routes: [r] } = await setup();
      await audit(project.id, r!.id, "mobile", daysAgo(3), { lcp: 3100, cls: "0.0800" });
      const base = { projectId: project.id, routeId: r!.id, profile: "mobile" as const, days: 30 as const };
      expect((await getSeries({ ...base, metric: "lcp" }, db, NOW)).points[0]!.value).toBe(3100);
      expect((await getSeries({ ...base, metric: "cls" }, db, NOW)).points[0]!.value).toBe(0.08);
      expect((await getSeries({ ...base, metric: "lcp" }, db, NOW)).threshold).toBeNull();
      expect((await getSeries({ ...base, metric: "seo" }, db, NOW)).threshold).toBe(90);
      await thresholds.setThresholds(project.id, [{ metric: "seo", minScore: 90, enabled: false }], db);
      expect((await getSeries({ ...base, metric: "seo" }, db, NOW)).threshold).toBeNull();
    });

    it("rechaza una ruta de otro proyecto", async () => {
      const a = await setup("Acme");
      const b = await setup("Otro");
      const err = await getSeries({ projectId: a.project.id, routeId: b.routes[0]!.id, profile: "mobile", metric: "seo", days: 30 }, db, NOW).catch((e) => e);
      expect(isDomainError(err) && err.code).toBe("NOT_FOUND");
    });
  });

  describe("proyectos del portal", () => {
    it("solo muestra proyectos en producción y no archivados, con sus promedios y alertas", async () => {
      const a = await setup("Acme");
      const dev = await projects.createProject(a.client.id, { name: "Pruebas", baseUrl: "https://dev.test" }, db);
      const gone = await projects.createProject(a.client.id, { name: "Viejo", baseUrl: "https://viejo.test" }, db);
      await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, gone.id));
      await projects.archiveProject(gone.id, db, {});
      const a1 = await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1), { p: 60, s: 80 });
      await alerts.evaluateAudit(a1.id, { db });

      const list = await portal.getPortalOverview(a.client.id, db);
      expect(list.map((p) => p.name)).toEqual(["Sitio Acme"]);
      expect(list[0]).toMatchObject({ openAlerts: 2, averages: { performance: 60, seo: 80 } });
      expect(list[0]!.lastAuditAt?.getTime()).toBe(daysAgo(1).getTime());
      expect(dev.id).toBeTruthy();
    });

    it("un cliente no puede ver proyectos de otro, ni de desarrollo, ni ids inválidos", async () => {
      const a = await setup("Acme");
      const b = await setup("Otro");
      const dev = await setup("Dev", "development");
      expect(await portal.getPortalProject(a.client.id, a.project.id, db)).toMatchObject({ id: a.project.id, name: "Sitio Acme" });
      expect(await portal.getPortalProject(a.client.id, b.project.id, db)).toBeNull();
      expect(await portal.getPortalProject(dev.client.id, dev.project.id, db)).toBeNull();
      expect(await portal.getPortalProject(a.client.id, "no-es-uuid", db)).toBeNull();
      expect(await portal.getPortalProject(a.client.id, "00000000-0000-4000-8000-000000000000", db)).toBeNull();
    });

    it("los puntos por mejorar no exponen datos internos", async () => {
      const a = await setup("Acme");
      await alerts.evaluateAudit((await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1), { s: 60 })).id, { db });
      const p = (await portal.getPortalProject(a.client.id, a.project.id, db))!;
      expect(p.improvements).toHaveLength(1);
      expect(Object.keys(p.improvements[0]!).sort()).toEqual(["id", "kind", "openedAt", "profile", "routePath", "summary"]);
      expect(JSON.stringify(p)).not.toMatch(/allowedHosts|magicToken|contactEmail|clientId/);
    });
  });
});
