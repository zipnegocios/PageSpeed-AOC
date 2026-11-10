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
import { generateClientPin } from "@/server/services/portal-pin";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import * as thresholds from "@/server/services/thresholds";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const NOW = new Date("2026-04-30T12:00:00Z");
const PIN_DEPS = { secret: "s".repeat(40) };
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

  describe("resolvePortal (identificador del cliente + PIN)", () => {
    const withSession = async () => true;
    const noSession = async () => false;

    it("sin sesión de PIN pide el PIN; con sesión da acceso. Un identificador anterior también vale", async () => {
      const { client } = await setup();
      await generateClientPin(client.id, {}, db, PIN_DEPS);
      expect(await portal.resolvePortal(client.slug, noSession, db)).toEqual({ state: "pin" });
      expect(await portal.resolvePortal(client.slug, withSession, db)).toEqual({ state: "ok", client: { id: client.id, name: "Acme" } });
      await clients.renameClientSlug(client.id, "acme-corp", db);
      expect(await portal.resolvePortal("acme-corp", withSession, db)).toMatchObject({ state: "ok" });
      expect(await portal.resolvePortal(client.slug, withSession, db)).toMatchObject({ state: "ok" }); // el anterior sigue valiendo
    });

    it("sin PIN configurado no hay acceso aunque el navegador traiga una sesión", async () => {
      const { client } = await setup();
      expect(await portal.resolvePortal(client.slug, withSession, db)).toEqual({ state: "pin" });
    });

    it("un identificador que no existe se ve igual que uno que pide PIN (no revela qué clientes hay); uno mal formado es inválido", async () => {
      expect(await portal.resolvePortal("no-existe", withSession, db)).toEqual({ state: "pin" });
      expect(await portal.resolvePortal("ACME", withSession, db)).toEqual({ state: "invalid" });
      expect(await portal.resolvePortal("../".repeat(20), withSession, db)).toEqual({ state: "invalid" });
      expect(await portal.resolvePortal("", withSession, db)).toEqual({ state: "invalid" });
    });

    it("el enlace antiguo con token ya no da acceso: solo lleva al portal con PIN", async () => {
      const { client } = await setup();
      const { magicToken } = await clients.getClient(client.id, db);
      await generateClientPin(client.id, {}, db, PIN_DEPS);
      expect(await portal.resolvePortal(magicToken, withSession, db)).toEqual({ state: "legacy", slug: client.slug });
      expect(await portal.resolvePortal("x".repeat(43), withSession, db)).toEqual({ state: "invalid" });
    });

    it("suspendido muestra el aviso sin pedir PIN; reactivar vuelve al PIN. Archivado deja de existir", async () => {
      const { client } = await setup();
      await generateClientPin(client.id, {}, db, PIN_DEPS);
      await clients.setClientStatus(client.id, "suspended", db);
      expect(await portal.resolvePortal(client.slug, noSession, db)).toEqual({ state: "suspended", clientName: "Acme" });
      await clients.setClientStatus(client.id, "active", db);
      expect(await portal.resolvePortal(client.slug, noSession, db)).toEqual({ state: "pin" });
      await clients.archiveClient(client.id, db);
      expect(await portal.resolvePortal(client.slug, withSession, db)).toEqual({ state: "pin" }); // ya no existe, igual que cualquier otro
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
      // También se llega por el identificador legible (slug), y solo dentro del cliente dueño.
      expect(await portal.getPortalProject(a.client.id, a.project.slug, db)).toMatchObject({ id: a.project.id, slug: a.project.slug });
      expect(await portal.getPortalProject(a.client.id, b.project.slug, db)).toBeNull();
      expect(await portal.getPortalProject(a.client.id, "no-es-uuid", db)).toBeNull();
      expect(await portal.getPortalProject(a.client.id, "00000000-0000-4000-8000-000000000000", db)).toBeNull();
    });

    it("el cliente solo ve auditorías correctas de sus proyectos y se marca la redacción en rutas con sesión", async () => {
      const a = await setup("Acme");
      const b = await setup("Otro");
      const ok = await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1));
      const failed = await audit(a.project.id, a.routes[0]!.id, "desktop", daysAgo(1), { status: "failed" });
      const other = await audit(b.project.id, b.routes[0]!.id, "mobile", daysAgo(1));

      const mine = await portal.getPortalAudit(a.client.id, a.project.id, ok.id, db);
      expect(mine?.audit.id).toBe(ok.id);
      expect(mine?.redact).toBe(false);
      expect(await portal.getPortalAudit(a.client.id, a.project.id, failed.id, db)).toBeNull(); // no terminó bien
      expect(await portal.getPortalAudit(a.client.id, a.project.id, other.id, db)).toBeNull(); // de otro proyecto
      expect(await portal.getPortalAudit(b.client.id, a.project.id, ok.id, db)).toBeNull(); // proyecto de otro cliente
      expect(await portal.getPortalAudit(a.client.id, a.project.id, "no-es-uuid", db)).toBeNull();
      expect(await portal.getPortalAudit(a.client.id, a.project.id, "00000000-0000-4000-8000-000000000000", db)).toBeNull();

      await db.update(s.routes).set({ requiresAuth: true }).where(eq(s.routes.id, a.routes[0]!.id));
      expect((await portal.getPortalAudit(a.client.id, a.project.id, ok.id, db))?.redact).toBe(true);
    });

    it("la fracción de agentes llega al resumen del cliente", async () => {
      const a = await setup("Acme");
      const row = await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1));
      await db.update(s.auditLogs).set({ agenticPassed: 1, agenticTotal: 4 }).where(eq(s.auditLogs.id, row.id));
      const p = (await portal.getPortalProject(a.client.id, a.project.id, db))!;
      expect(p.latest[0]!.agentic).toEqual({ passed: 1, total: 4 });
    });

    it("los puntos por mejorar no exponen datos internos", async () => {
      const a = await setup("Acme");
      await alerts.evaluateAudit((await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1), { s: 60 })).id, { db });
      const p = (await portal.getPortalProject(a.client.id, a.project.id, db))!;
      expect(p.improvements).toHaveLength(1);
      expect(Object.keys(p.improvements[0]!).sort()).toEqual(["id", "kind", "openedAt", "profile", "routePath", "summary"]);
      expect(JSON.stringify(p)).not.toMatch(/allowedHosts|magicToken|contactEmail|clientId/);
    });

    it("las métricas web esenciales de la última auditoría llegan al portal", async () => {
      const a = await setup("Acme");
      await audit(a.project.id, a.routes[0]!.id, "mobile", daysAgo(1), { lcp: 3100, tbt: 250, cls: "0.12" });
      const p = (await portal.getPortalProject(a.client.id, a.project.id, db))!;
      expect(p.latest[0]!.metrics).toEqual({ lcpMs: 3100, tbtMs: 250, cls: 0.12 });
    });
  });

  describe("árbol de páginas del portal", () => {
    const crawl = async (projectId: string, pages: Array<{ path: string; title: string | null; status?: number; finalPath?: string | null }>) => {
      const [run] = await db.insert(s.seoCrawlRuns).values({ projectId, trigger: "manual", status: "succeeded", finishedAt: new Date() }).returning();
      await db.insert(s.seoCrawlPages).values(pages.map((p) => ({ runId: run!.id, path: p.path, title: p.title, status: p.status ?? 200, finalPath: p.finalPath ?? null })));
    };

    it("arma el árbol con título, mejoras que suben al padre y métricas, y nada de datos internos", async () => {
      const a = await setup("Acme", "production", ["/", "/servicios", "/servicios/consultoria-legal", "/productos/grua"]);
      const [home, servicios, legal, grua] = a.routes;
      await audit(a.project.id, home!.id, "mobile", daysAgo(1), { p: 95 });
      await audit(a.project.id, servicios!.id, "mobile", daysAgo(1), { p: 90 });
      await audit(a.project.id, legal!.id, "mobile", daysAgo(1), { p: 40 });
      await audit(a.project.id, grua!.id, "desktop", daysAgo(1), { p: 80 });
      await alerts.evaluateAudit((await audit(a.project.id, legal!.id, "mobile", daysAgo(0), { p: 40 })).id, { db });
      await crawl(a.project.id, [
        { path: "/servicios", title: "Servicios | Acme" },
        { path: "/servicios/consultoria-legal", title: "Consultoría legal | Acme" },
        { path: "/productos/grua", title: "Grúa torre GT-200 | Acme" },
      ]);
      const project = (await portal.getPortalProject(a.client.id, a.project.id, db))!;
      const tree = await portal.getPortalRouteTree(project, db);

      expect(tree.pages).toBe(4);
      expect(tree.nodes.map((n) => n.title)).toEqual(["Inicio", "Productos", "Servicios"]);
      const productos = tree.nodes.find((n) => n.path === "/productos")!;
      expect(productos.page).toBeNull(); // padre virtual
      expect(productos.children[0]!.title).toBe("Grúa torre GT-200"); // título del rastreo sin la marca
      const serv = tree.nodes.find((n) => n.path === "/servicios")!;
      expect(serv.title).toBe("Servicios");
      expect(serv.ownImprovements).toBe(0);
      expect(serv.totalImprovements).toBeGreaterThan(0); // la mejora de la hija sube al padre
      expect(serv.children[0]!.title).toBe("Consultoría legal");
      expect(serv.children[0]!.page!.profiles.mobile!.metrics.lcpMs).toBe(2000);
      expect(JSON.stringify(tree)).not.toMatch(/allowedHosts|magicToken|contactEmail|r2Key/);
    });

    it("la etiqueta del administrador manda; el rastreo no vale si redirigió o si la ruta exige sesión", async () => {
      const a = await setup("Acme", "production", ["/a", "/b", "/c", "/d"]);
      for (const r of a.routes) await audit(a.project.id, r.id, "mobile", daysAgo(1));
      await routes.updateRouteDetails(a.routes[0]!.id, { label: "Nuestra empresa" }, db);
      await routes.updateRouteDetails(a.routes[3]!.id, { requiresAuth: true }, db);
      await crawl(a.project.id, [
        { path: "/a", title: "Título del rastreo" },
        { path: "/b", title: "Pantalla de acceso", finalPath: "/login" },
        { path: "/c", title: "Página con error", status: 500 },
        { path: "/d", title: "Panel privado" },
      ]);
      const tree = await portal.getPortalRouteTree((await portal.getPortalProject(a.client.id, a.project.id, db))!, db);
      const title = (path: string) => tree.nodes.find((n) => n.path === path)!.title;
      expect(title("/a")).toBe("Nuestra empresa");
      expect(title("/b")).toBe("B");
      expect(title("/c")).toBe("C");
      expect(title("/d")).toBe("D");
    });

    it("sin auditorías el árbol está vacío; un grupo por idioma usa el nombre del idioma", async () => {
      const a = await setup("Acme", "production", ["/es/servicios", "/en/services"]);
      expect((await portal.getPortalRouteTree((await portal.getPortalProject(a.client.id, a.project.id, db))!, db)).pages).toBe(0);
      for (const r of a.routes) await audit(a.project.id, r.id, "mobile", daysAgo(1));
      await db.insert(s.seoMarkets).values([{ projectId: a.project.id, lang: "es", prefix: "/es" }, { projectId: a.project.id, lang: "en", prefix: "/en" }]);
      const tree = await portal.getPortalRouteTree((await portal.getPortalProject(a.client.id, a.project.id, db))!, db);
      expect(tree.nodes.map((n) => n.title).sort()).toEqual(["Español", "Inglés"].sort());
    });
  });
});
