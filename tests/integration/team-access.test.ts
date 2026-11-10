import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Actor } from "@/server/domain/access";
import {
  assertAuditAccess,
  assertClientAccess,
  assertManageArchivedClient,
  assertManageClient,
  assertManageProject,
  assertProjectAccess,
  assertRouteAccess,
  loadScope,
} from "@/server/services/access";
import { summarize } from "@/server/services/admin-auth";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { getClientSharing, setClientShare, setProjectShare } from "@/server/services/team-access";
import { removeMember } from "@/server/services/team";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("equipo: quién ve qué", () => {
  const { db, pool } = createDb(url ?? "", 4);
  const noQueues = { maintenance: { add: async () => undefined } as never };
  let gustavo: typeof s.adminUsers.$inferSelect;
  let luis: typeof s.adminUsers.$inferSelect;
  let marta: typeof s.adminUsers.$inferSelect;
  const as = (u: typeof s.adminUsers.$inferSelect): Actor => ({ id: u.id, role: u.role as "owner" | "admin" });

  beforeAll(async () => { await runMigrations(url!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users, mcp_api_keys restart identity cascade`);
    const mk = async (email: string, role: "owner" | "admin") => (await db.insert(s.adminUsers).values({ email, passwordHash: "x", role, firstName: email.split("@")[0] }).returning())[0]!;
    gustavo = await mk("gustavo@zip.test", "owner");
    luis = await mk("luis@zip.test", "admin");
    marta = await mk("marta@zip.test", "admin");
  });

  /** Un cliente con dos proyectos (cada uno con una ruta) cuyo responsable es `owner`. */
  async function world(ownerId: string | null, name = "Acme") {
    const client = await clients.createClient({ name }, db, ownerId ? { ownerId } : undefined);
    const p1 = await projects.createProject(client.id, { name: `${name} Web`, baseUrl: `https://${name.toLowerCase()}1.test` }, db, noQueues);
    const p2 = await projects.createProject(client.id, { name: `${name} Tienda`, baseUrl: `https://${name.toLowerCase()}2.test` }, db, noQueues);
    const r1 = await routes.addRoute(p1.id, { path: "/" }, db);
    return { client, p1, p2, r1 };
  }

  it("el propietario ve todo; un miembro, solo sus clientes", async () => {
    const mine = await world(luis.id, "DeLuis");
    const others = await world(gustavo.id, "DeGustavo");
    const legacy = await world(null, "Antiguo");
    expect(await loadScope(db, as(gustavo))).toEqual({ all: true });
    const scope = await loadScope(db, as(luis));
    expect(scope).toEqual({ all: false, clientIds: [mine.client.id], projectIds: [] });
    await expect(assertProjectAccess(db, as(luis), mine.p1.id)).resolves.toMatchObject({ id: mine.p1.id });
    for (const w of [others, legacy]) await expect(assertProjectAccess(db, as(luis), w.p1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assertProjectAccess(db, as(gustavo), others.p1.id)).resolves.toBeTruthy();
    await expect(assertProjectAccess(db, as(gustavo), legacy.p1.id)).resolves.toBeTruthy();
  });

  it("compartir un cliente entero: ve todos sus proyectos, también los que se creen después; dejar de compartir lo quita", async () => {
    const w = await world(gustavo.id);
    await expect(assertClientAccess(db, as(luis), w.client.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setClientShare(as(gustavo), w.client.id, luis.id, true, db);
    await setClientShare(as(gustavo), w.client.id, luis.id, true, db); // idempotente
    await expect(assertClientAccess(db, as(luis), w.client.id)).resolves.toBeTruthy();
    await expect(assertProjectAccess(db, as(luis), w.p2.id)).resolves.toBeTruthy();
    const later = await projects.createProject(w.client.id, { name: "Nuevo", baseUrl: "https://nuevo.test" }, db, noQueues);
    await expect(assertProjectAccess(db, as(luis), later.id)).resolves.toBeTruthy();
    await setClientShare(as(gustavo), w.client.id, luis.id, false, db);
    await expect(assertProjectAccess(db, as(luis), w.p1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("compartir un solo proyecto: ve ese proyecto y el cliente solo como contenedor, no los demás", async () => {
    const w = await world(gustavo.id);
    await setProjectShare(as(gustavo), w.p1.id, luis.id, true, db);
    await expect(assertProjectAccess(db, as(luis), w.p1.id)).resolves.toBeTruthy();
    await expect(assertProjectAccess(db, as(luis), w.p2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assertClientAccess(db, as(luis), w.client.id, "any")).resolves.toBeTruthy();
    await expect(assertClientAccess(db, as(luis), w.client.id, "full")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("las rutas y las auditorías siguen al proyecto, y el id de proyecto que llega en la petición no se cree", async () => {
    const w = await world(gustavo.id);
    const other = await world(luis.id, "DeLuis");
    await expect(assertRouteAccess(db, as(luis), w.r1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setProjectShare(as(gustavo), w.p1.id, luis.id, true, db);
    await expect(assertRouteAccess(db, as(luis), w.r1.id)).resolves.toMatchObject({ project: { id: w.p1.id } });
    // Una ruta ajena se resuelve a su proyecto real, aunque el llamador diga que es de un proyecto suyo.
    const { project } = await assertRouteAccess(db, as(gustavo), w.r1.id);
    expect(project.id).not.toBe(other.p1.id);
    const [audit] = await db.insert(s.auditLogs).values({ projectId: w.p1.id, routeId: w.r1.id, profile: "mobile", trigger: "manual", phaseAtRun: "development", status: "queued" }).returning();
    await expect(assertAuditAccess(db, as(luis), audit!.id)).resolves.toBeTruthy();
    await setProjectShare(as(gustavo), w.p1.id, luis.id, false, db);
    await expect(assertAuditAccess(db, as(luis), audit!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("quien recibe un compartido no puede gestionarlo ni compartirlo; el responsable y el propietario sí", async () => {
    const w = await world(luis.id, "DeLuis");
    await setClientShare(as(luis), w.client.id, marta.id, true, db);
    await expect(assertClientAccess(db, as(marta), w.client.id)).resolves.toBeTruthy();
    await expect(assertManageClient(db, as(marta), w.client.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assertManageProject(db, as(marta), w.p1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setClientShare(as(marta), w.client.id, gustavo.id, true, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setProjectShare(as(marta), w.p1.id, luis.id, true, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assertManageClient(db, as(luis), w.client.id)).resolves.toBeTruthy();
    await expect(assertManageClient(db, as(gustavo), w.client.id)).resolves.toBeTruthy();
  });

  it("no se comparte con el propietario ni con el responsable, ni con alguien que no existe", async () => {
    const w = await world(luis.id, "DeLuis");
    await expect(setClientShare(as(luis), w.client.id, gustavo.id, true, db)).rejects.toMatchObject({ code: "INVALID" });
    await expect(setClientShare(as(gustavo), w.client.id, luis.id, true, db)).rejects.toMatchObject({ code: "INVALID" });
    await expect(setClientShare(as(luis), w.client.id, "00000000-0000-4000-8000-000000000000", true, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("la tarjeta «Compartir»: candidatos (sin propietario ni responsable) y con quién ya está; solo para quien gestiona", async () => {
    const w = await world(luis.id, "DeLuis");
    await setClientShare(as(luis), w.client.id, marta.id, true, db);
    const sharing = (await getClientSharing(as(luis), w.client.id, db))!;
    expect(sharing.candidates.map((m) => m.email)).toEqual(["marta@zip.test"]);
    expect(sharing.clientShared).toEqual([marta.id]);
    expect(await getClientSharing(as(marta), w.client.id, db)).toBeNull();
  });

  it("archivados: solo los gestiona el propietario o el responsable", async () => {
    const w = await world(luis.id, "DeLuis");
    await db.update(s.clients).set({ deletedAt: new Date() }).where(eq(s.clients.id, w.client.id));
    await expect(assertManageArchivedClient(db, as(luis), w.client.id)).resolves.toBeTruthy();
    await expect(assertManageArchivedClient(db, as(marta), w.client.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("al quitar a alguien del equipo, sus clientes pasan al propietario, sus compartidos caen y sus claves de agente se borran", async () => {
    const mine = await world(luis.id, "DeLuis");
    const gus = await world(gustavo.id, "DeGustavo");
    await setClientShare(as(gustavo), gus.client.id, luis.id, true, db);
    await db.insert(s.mcpApiKeys).values({ name: "k", keyHash: "h", createdBy: luis.id, allAccess: false });
    await removeMember(summarize(gustavo), luis.id, db, { now: () => new Date() });
    const [c] = await db.select().from(s.clients).where(eq(s.clients.id, mine.client.id));
    expect(c!.ownerId).toBe(gustavo.id);
    expect(await db.select().from(s.teamShares)).toHaveLength(0);
    expect(await db.select().from(s.mcpApiKeys)).toHaveLength(0);
  });
});
