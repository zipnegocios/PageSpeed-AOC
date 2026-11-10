import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Mailer, MailMessage } from "@/server/notify/mailer";
import * as clients from "@/server/services/clients";
import { sendClientWelcome, WELCOME_COOLDOWN_MS } from "@/server/services/client-welcome";
import { generateClientPin, readStoredPin, verifyClientPin } from "@/server/services/portal-pin";
import * as projects from "@/server/services/projects";

const dbUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(40);
const AUTH_KEY = Buffer.alloc(32, 7).toString("base64");

describe.skipIf(!dbUrl)("bienvenida al cliente", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let sent: MailMessage[] = [];
  let failMail = false;
  const mailer: Mailer = {
    send: async (m) => {
      if (failMail) throw new Error("SMTP caído");
      sent.push(m);
    },
  };
  let clock = new Date("2026-11-10T12:00:00Z");
  const deps = () => ({ mailer, secret: SECRET, authKey: AUTH_KEY, appUrl: "https://app.test/", now: () => clock });
  const form = (extra: Record<string, unknown> = {}) => ({ projectId: "", kind: "site", techLabel: "WordPress", includesServer: true, ccText: "", ...extra });

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    sent = [];
    failMail = false;
    clock = new Date("2026-11-10T12:00:00Z");
  });

  async function setup(phase: "development" | "production" = "production", extra: Record<string, string> = {}) {
    const client = await clients.createClient({ name: "Café Aurora", contactName: "Ana Ríos", contactEmail: "ana@aurora.test", ...extra }, db);
    const project = await projects.createProject(client.id, { name: "Sitio", baseUrl: "https://www.cafeaurora.test" }, db);
    if (phase === "production") await db.update(s.projects).set({ phase }).where(eq(s.projects.id, project.id));
    return { client, project };
  }
  const clientRow = async (id: string) => (await db.select().from(s.clients).where(eq(s.clients.id, id)))[0]!;
  const projectRow = async (id: string) => (await db.select().from(s.projects).where(eq(s.projects.id, id)))[0]!;
  const log = () => db.select().from(s.notifications);

  it("envía un solo correo al contacto, con copia al equipo, y genera el PIN si no había", async () => {
    const { client, project } = await setup();
    const r = await sendClientWelcome(client.id, form({ projectId: project.id, ccText: "Luis Vega <luis@aurora.test>\nMaría Soto <maria@aurora.test>" }), {}, db, deps());
    expect(r).toMatchObject({ to: "ana@aurora.test", cc: ["luis@aurora.test", "maria@aurora.test"], test: false, newPin: true });
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("ana@aurora.test");
    expect(m.cc).toEqual(["luis@aurora.test", "maria@aurora.test"]);
    expect(m.subject).toBe("Su sitio ahora tiene seguimiento técnico permanente");
    expect(m.text).toContain("Hola Ana, Luis y María,");
    expect(m.text).toContain("cafeaurora.test");
    expect(m.text).toContain("https://app.test/c/" + client.slug);
    // El PIN del correo es el que vale en el portal.
    const pin = /PIN: (\d{6})/.exec(m.text)![1]!;
    expect((await verifyClientPin(client.slug, pin, db, deps())).ok).toBe(true);
    expect(readStoredPin(await clientRow(client.id), deps())).toBe(pin);
  });

  it("dos personas con la misma dirección: se nombran las dos y el correo llega una sola vez", async () => {
    const client = await clients.createClient({ name: "Contigo Constructions", contactName: "Daniel Osorio", contactEmail: "contact@contigo.test" }, db);
    const project = await projects.createProject(client.id, { name: "Sitio", baseUrl: "https://contigoconstructions.test" }, db);
    await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, project.id));
    const r = await sendClientWelcome(client.id, form({ projectId: project.id, ccText: "Ana María Osorio <contact@contigo.test>" }), {}, db, deps());
    expect(r).toMatchObject({ to: "contact@contigo.test", cc: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("contact@contigo.test");
    expect(sent[0]!.cc).toBeUndefined();
    expect(sent[0]!.text).toContain("Hola Daniel y Ana María,");
    expect(sent[0]!.text).toContain("No tienen que hacer nada");
    expect(sent[0]!.text).toContain("Soy Gustavo Amarista (zipnegocios)");
    // Se conserva a Ana María aunque su dirección sea la del contacto principal.
    expect((await clientRow(client.id)).ccContacts).toEqual([{ name: "Ana María Osorio", email: "contact@contigo.test" }]);
  });

  it("guarda lo del formulario para los próximos envíos y anota el envío", async () => {
    const { client, project } = await setup();
    await sendClientWelcome(client.id, form({ projectId: project.id, kind: "shop", techLabel: "Shopify", includesServer: false, ccText: "Luis <luis@aurora.test>" }), {}, db, deps());
    expect(await projectRow(project.id)).toMatchObject({ kind: "shop", techLabel: "Shopify", includesServer: false });
    const c = await clientRow(client.id);
    expect(c.ccContacts).toEqual([{ name: "Luis", email: "luis@aurora.test" }]);
    expect(c.welcomeSentAt).toEqual(clock);
    const [n] = await log();
    expect(n).toMatchObject({ type: "welcome", status: "sent", clientId: client.id, projectId: project.id });
    expect(n!.recipient).toBe("ana@aurora.test, luis@aurora.test");
    // La tienda en Shopify: sin servidor y sin nota de versiones.
    expect(sent[0]!.text).toContain("tienda hecha en Shopify");
    expect(sent[0]!.text).not.toContain("Servidor, servicios y APIs");
    expect(sent[0]!.text).not.toContain("Las versiones caducan");
  });

  it("si el cliente ya tiene un PIN que se puede mostrar, lo reutiliza y no lo cambia", async () => {
    const { client, project } = await setup();
    const { pin } = await generateClientPin(client.id, {}, db, deps());
    const before = await clientRow(client.id);
    const r = await sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps());
    expect(r.newPin).toBe(false);
    expect(sent[0]!.text).toContain(`PIN: ${pin}`);
    const after = await clientRow(client.id);
    expect(after.pinVersion).toBe(before.pinVersion);
    expect(after.pinHash).toBe(before.pinHash);
  });

  it("si el correo falla no activa el PIN nuevo, deja constancia y conserva lo guardado", async () => {
    const { client, project } = await setup();
    failMail = true;
    await expect(sendClientWelcome(client.id, form({ projectId: project.id, techLabel: "Next.js" }), {}, db, deps())).rejects.toMatchObject({ code: "UPSTREAM" });
    const c = await clientRow(client.id);
    expect(c.pinHash).toBeNull();
    expect(c.welcomeSentAt).toBeNull();
    expect(await projectRow(project.id)).toMatchObject({ techLabel: "Next.js" });
    const [n] = await log();
    expect(n).toMatchObject({ type: "welcome", status: "failed" });
    expect(n!.error).toContain("SMTP caído");
    // Se puede reintentar enseguida: el fallo no activa el freno.
    failMail = false;
    await sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps());
    expect(sent).toHaveLength(1);
  });

  it("frena el reenvío durante unos minutos y luego lo permite", async () => {
    const { client, project } = await setup();
    await sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps());
    await expect(sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps())).rejects.toMatchObject({ code: "CONFLICT" });
    clock = new Date(clock.getTime() + WELCOME_COOLDOWN_MS + 1000);
    await sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps());
    expect(sent).toHaveLength(2);
  });

  it("la prueba va solo al administrador y no toca nada del cliente", async () => {
    const { client, project } = await setup();
    const r = await sendClientWelcome(client.id, form({ projectId: project.id, techLabel: "Next.js", ccText: "Luis <luis@aurora.test>" }), { testTo: "admin@zip.test" }, db, deps());
    expect(r).toMatchObject({ to: "admin@zip.test", cc: [], test: true, newPin: false });
    expect(sent[0]!.to).toBe("admin@zip.test");
    expect(sent[0]!.cc).toBeUndefined();
    expect(sent[0]!.subject.startsWith("[PRUEBA] ")).toBe(true);
    const c = await clientRow(client.id);
    expect(c.pinHash).toBeNull();
    expect(c.welcomeSentAt).toBeNull();
    expect(c.ccContacts).toEqual([]);
    expect((await projectRow(project.id)).techLabel).toBeNull();
    expect(await log()).toHaveLength(0);
    // Sirve aunque el cliente no tenga correo o esté suspendido, y no cuenta para el freno.
    await sendClientWelcome(client.id, form({ projectId: project.id }), { testTo: "admin@zip.test" }, db, deps());
    expect(sent).toHaveLength(2);
  });

  it("rechaza lo que no corresponde", async () => {
    const { client, project } = await setup();
    const other = await setup("production", { name: "Otro" }).catch(() => null);
    expect(other).not.toBeNull();
    await expect(sendClientWelcome(client.id, form({ projectId: other!.project.id }), {}, db, deps())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendClientWelcome(client.id, form({ projectId: project.id, techLabel: "" }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    await expect(sendClientWelcome(client.id, form({ projectId: project.id, kind: "otro" }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    await expect(sendClientWelcome(client.id, form({ projectId: project.id, ccText: "esto no es un correo" }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    await db.update(s.clients).set({ status: "suspended" }).where(eq(s.clients.id, client.id));
    await expect(sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    expect(sent).toHaveLength(0);
  });

  it("pide un proyecto en producción y un correo de contacto", async () => {
    const dev = await setup("development");
    await expect(sendClientWelcome(dev.client.id, form({ projectId: dev.project.id }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    const noMail = await clients.createClient({ name: "Sin correo" }, db);
    const p = await projects.createProject(noMail.id, { name: "Sitio", baseUrl: "https://sc.test" }, db);
    await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, p.id));
    await expect(sendClientWelcome(noMail.id, form({ projectId: p.id }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    expect(sent).toHaveLength(0);
  });
});
