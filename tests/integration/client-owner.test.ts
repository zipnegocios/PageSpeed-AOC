import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Mailer, MailMessage } from "@/server/notify/mailer";
import { sweepNotifications } from "@/server/services/alerts";
import { assignClientOwner, listResponsibles, resolveSender } from "@/server/services/client-sender";
import { sendClientWelcome } from "@/server/services/client-welcome";
import * as clients from "@/server/services/clients";
import { generateClientPin } from "@/server/services/portal-pin";
import * as portal from "@/server/services/portal";
import * as projects from "@/server/services/projects";
import { updateProfile } from "@/server/services/profile";
import { summarize } from "@/server/services/admin-auth";

const dbUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(40);
const AUTH_KEY = Buffer.alloc(32, 7).toString("base64");

describe.skipIf(!dbUrl)("responsable del cliente", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let sent: MailMessage[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const clock = new Date("2026-11-10T12:00:00Z");
  const deps = () => ({ mailer, secret: SECRET, authKey: AUTH_KEY, appUrl: "https://app.test/", now: () => clock });
  let gustavo: typeof s.adminUsers.$inferSelect;
  let luis: typeof s.adminUsers.$inferSelect;

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users restart identity cascade`);
    sent = [];
    const [g] = await db.insert(s.adminUsers).values({ email: "gustavo@zip.test", passwordHash: "x", role: "owner", firstName: "Gustavo", lastName: "Amarista" }).returning();
    const [l] = await db.insert(s.adminUsers).values({ email: "luis@zip.test", passwordHash: "x", role: "admin", firstName: "Luis", lastName: "Porteles", phone: "+1 555 010 0000" }).returning();
    gustavo = g!;
    luis = l!;
  });

  const production = async (clientId: string, name = "Sitio") => {
    const p = await projects.createProject(clientId, { name, baseUrl: "https://acme.test" }, db);
    await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, p.id));
    return p;
  };
  const form = (projectId: string) => ({ projectId, kind: "site", techLabel: "WordPress", includesServer: true, ccText: "" });

  it("quien crea el cliente queda como su responsable; sin responsable, la cuenta propietaria", async () => {
    const mine = await clients.createClient({ name: "De Luis", contactName: "Ana", contactEmail: "ana@acme.test" }, db, { ownerId: luis!.id });
    const legacy = await clients.createClient({ name: "Antiguo" }, db);
    expect(mine.ownerId).toBe(luis!.id);
    expect(legacy.ownerId).toBeNull();
    expect(await resolveSender(db, mine)).toMatchObject({ name: "Luis Porteles", whatsapp: "+1 555 010 0000", email: "luis@zip.test" });
    expect(await resolveSender(db, legacy)).toMatchObject({ name: "Gustavo Amarista", email: "gustavo@zip.test" });
  });

  it("si la cuenta responsable ya no existe, el cliente pasa a la cuenta propietaria", async () => {
    const c = await clients.createClient({ name: "De Luis" }, db, { ownerId: luis!.id });
    await db.delete(s.adminUsers).where(eq(s.adminUsers.id, luis!.id));
    expect(await resolveSender(db, c)).toMatchObject({ name: "Gustavo Amarista" });
  });

  it("la cuenta propietaria sin teléfono propio conserva el WhatsApp de siempre; otro administrador sin teléfono, ninguno", async () => {
    const mine = await clients.createClient({ name: "Mío" }, db, { ownerId: gustavo!.id });
    expect((await resolveSender(db, mine)).whatsapp).toBe("+1 316 469 5701");
    await db.update(s.adminUsers).set({ phone: null }).where(eq(s.adminUsers.id, luis!.id));
    const theirs = await clients.createClient({ name: "Suyo" }, db, { ownerId: luis!.id });
    expect((await resolveSender(db, theirs)).whatsapp).toBeNull();
  });

  it("se puede reasignar, y no a alguien que no existe", async () => {
    const c = await clients.createClient({ name: "Cliente" }, db, { ownerId: gustavo!.id });
    await assignClientOwner(c.id, luis!.id, db);
    expect((await resolveSender(db, (await clients.getClient(c.id, db))))).toMatchObject({ name: "Luis Porteles" });
    await expect(assignClientOwner(c.id, "00000000-0000-4000-8000-000000000000", db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assignClientOwner("00000000-0000-4000-8000-000000000000", luis!.id, db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listResponsibles(db)).map((r) => r.name)).toEqual(["Gustavo Amarista", "Luis Porteles"]);
  });

  it("la bienvenida de un cliente de Luis sale a su nombre, con su firma y sus respuestas a él", async () => {
    const c = await clients.createClient({ name: "De Luis", contactName: "Ana Ríos", contactEmail: "ana@acme.test" }, db, { ownerId: luis!.id });
    const p = await production(c.id);
    await sendClientWelcome(c.id, form(p.id), {}, db, deps());
    const m = sent[0]!;
    expect(m).toMatchObject({ to: "ana@acme.test", fromName: "Luis Porteles", replyTo: "luis@zip.test" });
    expect(m.text).toContain("Soy Luis Porteles (zipnegocios)");
    expect(m.text).toContain("WhatsApp +1 555 010 0000");
    expect(m.text).not.toContain("Gustavo");
    expect(m.html).toContain("Luis Porteles");
    expect(m.html).not.toContain("Gustavo");
    expect(m.html).toContain("https://app.test/brand/logo-glyph-email.png");
  });

  it("la de un cliente de Gustavo sigue saliendo a su nombre", async () => {
    const c = await clients.createClient({ name: "De Gustavo", contactName: "Ana Ríos", contactEmail: "ana@acme.test" }, db, { ownerId: gustavo!.id });
    const p = await production(c.id);
    await sendClientWelcome(c.id, form(p.id), {}, db, deps());
    expect(sent[0]).toMatchObject({ fromName: "Gustavo Amarista", replyTo: "gustavo@zip.test" });
    expect(sent[0]!.text).toContain("WhatsApp +1 316 469 5701");
  });

  it("el PIN nuevo de un cliente de Luis también va a su nombre", async () => {
    const c = await clients.createClient({ name: "De Luis", contactName: "Ana", contactEmail: "ana@acme.test" }, db, { ownerId: luis!.id });
    await generateClientPin(c.id, { email: true }, db, deps());
    expect(sent[0]).toMatchObject({ fromName: "Luis Porteles", replyTo: "luis@zip.test" });
    expect(sent[0]!.text).toContain("Luis Porteles");
  });

  it("el aviso de servicio suspendido del portal da el contacto del responsable", async () => {
    const c = await clients.createClient({ name: "De Luis" }, db, { ownerId: luis!.id });
    await db.update(s.clients).set({ status: "suspended" }).where(eq(s.clients.id, c.id));
    const access = await portal.resolvePortal(c.slug, async () => false, db);
    expect(access).toEqual({ state: "suspended", clientName: "De Luis", contact: { name: "Luis Porteles", whatsapp: "+1 555 010 0000" } });
  });

  describe("alertas", () => {
    const openAlert = async (projectId: string) => {
      const [route] = await db.insert(s.routes).values({ projectId, path: "/", url: "https://acme.test/", monitored: true }).returning();
      await db.insert(s.alertStates).values({ projectId, routeId: route!.id, profile: "mobile", kind: "threshold", metric: "performance", status: "open", lastValue: 50, thresholdAtOpen: 80 });
    };

    it("a los clientes de Luis les avisa Luis; a los del propietario, el destinatario general", async () => {
      const a = await clients.createClient({ name: "De Luis" }, db, { ownerId: luis!.id });
      const b = await clients.createClient({ name: "De Gustavo" }, db, { ownerId: gustavo!.id });
      const c = await clients.createClient({ name: "Antiguo" }, db);
      for (const cl of [a, b, c]) await openAlert((await production(cl.id)).id);
      const r = await sweepNotifications({ db, mailer, recipient: "alertas@zip.test", appUrl: "https://app.test", now: () => clock });
      expect(r.sent).toBe(3);
      const byClient = new Map(sent.map((m) => [m.subject, m.to]));
      expect(sent.map((m) => m.to).sort()).toEqual(["alertas@zip.test", "alertas@zip.test", "luis@zip.test"]);
      expect([...byClient.values()].filter((t) => t === "luis@zip.test")).toHaveLength(1);
      const logged = await db.select().from(s.notifications);
      expect(logged.map((n) => n.recipient).sort()).toEqual(["alertas@zip.test", "alertas@zip.test", "luis@zip.test"]);
    });
  });

  describe("perfil", () => {
    it("guarda el WhatsApp, lo valida y lo borra si va vacío", async () => {
      const me = summarize(gustavo!);
      expect((await updateProfile(me, { firstName: "Gustavo", lastName: "Amarista", phone: "+1 316 469 5701" }, db)).phone).toBe("+1 316 469 5701");
      await expect(updateProfile(me, { firstName: "G", lastName: "A", phone: "no es un teléfono" }, db)).rejects.toMatchObject({ code: "INVALID" });
      expect((await updateProfile(me, { firstName: "Gustavo", lastName: "Amarista", phone: "" }, db)).phone).toBeNull();
    });
  });
});
