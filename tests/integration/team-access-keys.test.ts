import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Actor } from "@/server/domain/access";
import { canAccessProject } from "@/server/domain/mcp-access";
import { assertKeyAccess, authenticateApiKey, createApiKey, listApiKeys, updateApiKey } from "@/server/services/api-keys";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { setClientShare } from "@/server/services/team-access";
import { removeMember } from "@/server/services/team";
import { summarize } from "@/server/services/admin-auth";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("equipo: las claves de agente nunca ven más que quien las creó", () => {
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
    const mk = async (email: string, role: "owner" | "admin") => (await db.insert(s.adminUsers).values({ email, passwordHash: "x", role }).returning())[0]!;
    gustavo = await mk("gustavo@zip.test", "owner");
    luis = await mk("luis@zip.test", "admin");
    marta = await mk("marta@zip.test", "admin");
  });

  async function world(ownerId: string, name: string) {
    const client = await clients.createClient({ name }, db, { ownerId });
    const p = await projects.createProject(client.id, { name: `${name} Web`, baseUrl: `https://${name.toLowerCase()}.test` }, db, noQueues);
    return { client, p };
  }
  const form = (extra: Record<string, unknown> = {}) => ({ name: "Mi agente", preset: "read", access: "all", ...extra });

  it("una clave de miembro con «acceso total» ve solo lo que él ve, y gana lo que se le comparta después", async () => {
    const mine = await world(luis.id, "DeLuis");
    const other = await world(gustavo.id, "DeGustavo");
    const { key, view } = await createApiKey(form(), db, as(luis));
    expect(view.scope.all).toBe(true);
    const auth = (await authenticateApiKey(key, db))!;
    expect(canAccessProject(auth.access, { id: mine.p.id, clientId: mine.client.id })).toBe(true);
    expect(canAccessProject(auth.access, { id: other.p.id, clientId: other.client.id })).toBe(false);
    await setClientShare(as(gustavo), other.client.id, luis.id, true, db);
    expect(canAccessProject((await authenticateApiKey(key, db))!.access, { id: other.p.id, clientId: other.client.id })).toBe(true);
    // Y la pierde en cuanto se deja de compartir.
    await setClientShare(as(gustavo), other.client.id, luis.id, false, db);
    expect(canAccessProject((await authenticateApiKey(key, db))!.access, { id: other.p.id, clientId: other.client.id })).toBe(false);
  });

  it("un miembro no puede elegir clientes o proyectos que no ve; el propietario sí, y su clave no se recorta", async () => {
    const other = await world(gustavo.id, "DeGustavo");
    await expect(createApiKey(form({ access: "selected", clientIds: [other.client.id] }), db, as(luis))).rejects.toThrow(/ya no existe/);
    const { key } = await createApiKey(form({ access: "selected", clientIds: [other.client.id] }), db, as(gustavo));
    expect(canAccessProject((await authenticateApiKey(key, db))!.access, { id: other.p.id, clientId: other.client.id })).toBe(true);
  });

  it("cada miembro ve y gestiona solo sus claves; el propietario ve todas", async () => {
    await createApiKey(form({ name: "De Luis" }), db, as(luis));
    await createApiKey(form({ name: "De Marta" }), db, as(marta));
    await createApiKey(form({ name: "Del propietario" }), db, as(gustavo));
    expect((await listApiKeys(db, as(luis))).map((k) => k.name)).toEqual(["De Luis"]);
    expect((await listApiKeys(db, as(gustavo))).map((k) => k.name).sort()).toEqual(["De Luis", "De Marta", "Del propietario"]);
    const [luisKey] = await db.select().from(s.mcpApiKeys).where(eq(s.mcpApiKeys.createdBy, luis.id));
    await expect(assertKeyAccess(db, as(marta), luisKey!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assertKeyAccess(db, as(luis), luisKey!.id)).resolves.toBeUndefined();
    await expect(assertKeyAccess(db, as(gustavo), luisKey!.id)).resolves.toBeUndefined();
    await expect(updateApiKey(luisKey!.id, form({ name: "Nuevo" }), db, as(luis))).resolves.toMatchObject({ name: "Nuevo" });
  });

  it("si la persona sale del equipo, sus claves dejan de existir", async () => {
    const { key } = await createApiKey(form(), db, as(luis));
    expect(await authenticateApiKey(key, db)).not.toBeNull();
    await removeMember(summarize(gustavo), luis.id, db, { now: () => new Date() });
    expect(await authenticateApiKey(key, db)).toBeNull();
  });
});
