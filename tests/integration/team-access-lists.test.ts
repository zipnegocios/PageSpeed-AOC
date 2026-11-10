import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Actor } from "@/server/domain/access";
import { loadScope } from "@/server/services/access";
import { listOpenAlerts, listRecentNotifications } from "@/server/services/alerts";
import { listArchivedClients, listArchivedProjects } from "@/server/services/archive";
import * as clients from "@/server/services/clients";
import { getFleet, listRecentPagesGlobal } from "@/server/services/dashboard";
import * as projects from "@/server/services/projects";
import { getQueueStatus } from "@/server/services/queue-status";
import * as routes from "@/server/services/routes";
import { getSeoOverview } from "@/server/services/seo-connections";
import { setClientShare, setProjectShare } from "@/server/services/team-access";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-06T12:00:00Z");

describe.skipIf(!url)("equipo: los listados solo traen lo que la persona ve", () => {
  const { db, pool } = createDb(url ?? "", 4);
  const noQueues = { maintenance: { add: async () => undefined } as never };
  let gustavo: typeof s.adminUsers.$inferSelect;
  let luis: typeof s.adminUsers.$inferSelect;
  let marta: typeof s.adminUsers.$inferSelect;
  const as = (u: typeof s.adminUsers.$inferSelect): Actor => ({ id: u.id, role: u.role as "owner" | "admin" });

  beforeAll(async () => { await runMigrations(url!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users restart identity cascade`);
    const mk = async (email: string, role: "owner" | "admin") => (await db.insert(s.adminUsers).values({ email, passwordHash: "x", role }).returning())[0]!;
    gustavo = await mk("gustavo@zip.test", "owner");
    luis = await mk("luis@zip.test", "admin");
    marta = await mk("marta@zip.test", "admin");
  });

  /** Un cliente con dos proyectos en producción; cada uno con una ruta, una auditoría fallida, una alerta abierta y una notificación. */
  async function world(ownerId: string | null, name: string) {
    const client = await clients.createClient({ name }, db, ownerId ? { ownerId } : undefined);
    const out = [];
    for (const label of ["Web", "Tienda"]) {
      const p = await projects.createProject(client.id, { name: `${name} ${label}`, baseUrl: `https://${name.toLowerCase()}-${label.toLowerCase()}.test` }, db, noQueues);
      await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, p.id));
      const r = await routes.addRoute(p.id, { path: "/" }, db);
      await db.insert(s.auditLogs).values({ projectId: p.id, routeId: r.id, profile: "mobile", trigger: "manual", phaseAtRun: "production", status: "failed", errorCode: "TIMEOUT", queuedAt: NOW, finishedAt: NOW });
      await db.insert(s.alertStates).values({ projectId: p.id, routeId: r.id, profile: "mobile", kind: "audit_failure", status: "open" });
      await db.insert(s.notifications).values({ projectId: p.id, clientId: client.id, type: "failure", recipient: "x@x.test", subject: "s", status: "sent", sentAt: NOW });
      out.push(p);
    }
    return { client, web: out[0]!, shop: out[1]! };
  }

  async function seeing(u: typeof s.adminUsers.$inferSelect) {
    const scope = await loadScope(db, as(u));
    return {
      clients: (await clients.listClients(db, scope)).map((c) => c.name),
      projects: (await projects.listAllProjects(db, scope)).map((p) => p.name),
      fleet: (await getFleet(db, NOW, scope)).map((p) => p.name),
      alerts: (await listOpenAlerts(undefined, db, scope)).map((a) => a.projectName),
      notifications: (await listRecentNotifications(30, undefined, db, scope)).map((n) => n.projectName),
      pages: (await listRecentPagesGlobal(10, db, scope)).map((p) => p.projectName),
      seo: (await getSeoOverview(db, scope)).map((p) => p.name),
      queue: await getQueueStatus({ db, scope, redis: { get: async () => { throw new Error("sin redis"); } } as never }),
    };
  }

  it("el propietario ve todo; Luis, solo lo suyo; quien no tiene nada, nada", async () => {
    await world(luis.id, "DeLuis");
    await world(gustavo.id, "DeGustavo");
    await world(null, "Antiguo");
    const owner = await seeing(gustavo);
    expect(owner.clients).toEqual(["Antiguo", "DeGustavo", "DeLuis"]);
    expect(owner.projects).toHaveLength(6);
    expect(owner.alerts).toHaveLength(6);
    const mine = await seeing(luis);
    expect(mine.clients).toEqual(["DeLuis"]);
    expect(mine.projects).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    expect(mine.fleet.sort()).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    expect(mine.alerts.sort()).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    expect(mine.notifications).toHaveLength(2);
    expect(mine.pages.sort()).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    expect(mine.seo.sort()).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    expect(mine.queue.recentFailures.map((f) => f.projectName).sort()).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    expect(mine.queue.schedules.map((x) => x.projectName).sort()).toEqual(["DeLuis Tienda", "DeLuis Web"]);
    const none = await seeing(marta);
    expect([none.clients, none.projects, none.fleet, none.alerts, none.notifications, none.pages, none.seo]).toEqual([[], [], [], [], [], [], []]);
    expect(none.queue.recentFailures).toEqual([]);
    expect(none.queue.schedules).toEqual([]);
  });

  it("los contadores de la cola son del sistema: solo el propietario los ve (aquí no hay Redis: sin contadores en ambos casos, pero el recorte no rompe nada)", async () => {
    await world(luis.id, "DeLuis");
    expect((await seeing(luis)).queue.counts).toBeNull();
  });

  it("un cliente compartido entero entra con todos sus proyectos; uno compartido por proyecto, solo con ese", async () => {
    const a = await world(gustavo.id, "ClienteA");
    const b = await world(gustavo.id, "ClienteB");
    await setClientShare(as(gustavo), a.client.id, marta.id, true, db);
    await setProjectShare(as(gustavo), b.shop.id, marta.id, true, db);
    const seen = await seeing(marta);
    expect(seen.clients).toEqual(["ClienteA", "ClienteB"]);
    expect(seen.projects).toEqual(["ClienteA Tienda", "ClienteA Web", "ClienteB Tienda"]);
    expect(seen.alerts.sort()).toEqual(["ClienteA Tienda", "ClienteA Web", "ClienteB Tienda"]);
    // Un cliente visible solo por un proyecto cuenta solo los proyectos que se ven.
    const list = await clients.listClients(db, await loadScope(db, as(marta)));
    expect(list.find((c) => c.name === "ClienteB")!.projectCount).toBe(1);
    expect(list.find((c) => c.name === "ClienteA")!.projectCount).toBe(2);
  });

  it("archivados: cada quien ve solo los que puede gestionar", async () => {
    const mine = await world(luis.id, "DeLuis");
    const theirs = await world(gustavo.id, "DeGustavo");
    await setClientShare(as(gustavo), theirs.client.id, luis.id, true, db);
    await db.update(s.clients).set({ deletedAt: NOW }).where(eq(s.clients.id, mine.client.id));
    await db.update(s.projects).set({ deletedAt: NOW }).where(eq(s.projects.id, theirs.web.id));
    expect((await listArchivedClients(db, as(luis))).map((c) => c.name)).toEqual(["DeLuis"]);
    expect((await listArchivedClients(db, as(marta))).map((c) => c.name)).toEqual([]);
    expect((await listArchivedClients(db, as(gustavo))).map((c) => c.name)).toEqual(["DeLuis"]);
    // Un proyecto archivado de un cliente que solo le compartieron no lo puede restaurar.
    expect(await listArchivedProjects(db, as(luis))).toEqual([]);
    expect((await listArchivedProjects(db, as(gustavo))).map((p) => p.name)).toEqual(["DeGustavo Web"]);
  });
});
