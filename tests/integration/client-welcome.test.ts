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
  /** Un producto con valores razonables; `extra` los cambia. `includesServer` es atajo para marcar o no el servicio de servidor. */
  const form = (extra: Record<string, unknown> = {}) => {
    const { projectId = "", solutions, techLabel = "WordPress", techs, includesServer = true, services, ccText = "", initialImprovement = false } = extra as {
      projectId?: string; solutions?: string[]; techLabel?: string; techs?: string[]; includesServer?: boolean; services?: string[]; ccText?: string; initialImprovement?: boolean;
    };
    return {
      products: [{ projectId, solutions: solutions ?? ["sitio web"], techs: techs ?? (techLabel ? [techLabel] : []), services: services ?? (includesServer ? ["web", "seo", "server", "security"] : ["web", "seo", "security"]), initialImprovement }],
      ccText,
    };
  };

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users restart identity cascade`);
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
    expect(m.subject).toBe("Sus activos digitales ahora tienen acompañamiento técnico de punta a punta");
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

  describe("varios productos y texto libre", () => {
    async function twoProducts() {
      const { client, project } = await setup();
      const second = await projects.createProject(client.id, { name: "Aplicación", baseUrl: "https://app.cafeaurora.test" }, db);
      await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, second.id));
      return { client, first: project, second };
    }

    it("presenta todos los productos en un solo correo y guarda lo de cada uno", async () => {
      const { client, first, second } = await twoProducts();
      await sendClientWelcome(
        client.id,
        {
          products: [
            { projectId: first.id, solutions: ["tienda online (e-commerce)"], techs: ["Shopify", "Klaviyo"], services: ["web", "seo", "security"], initialImprovement: true },
            { projectId: second.id, solutions: ["aplicación móvil iOS", "chatbot"], techs: ["Swift (iOS)", "Firebase"], services: ["server", "deps", "domain", "security"], initialImprovement: false },
          ],
          ccText: "Luis Vega <luis@aurora.test>",
        },
        {},
        db,
        deps(),
      );
      expect(sent).toHaveLength(1);
      const t = sent[0]!.text;
      expect(t).toContain("quien se encarga de sus activos digitales");
      expect(t).toContain("www.cafeaurora.test".replace("www.", "") + " · tienda online (e-commerce) en Shopify y Klaviyo");
      expect(t).toContain("app.cafeaurora.test · aplicación móvil iOS y chatbot en Swift (iOS) y Firebase");
      expect(t).toContain("Con mi equipo revisamos cada aspecto de cada uno");
      // Lo que cubren los dos, unido: web y visitas del primero, y servidor, dependencias y dominio del segundo.
      expect(t).toContain("Velocidad y calidad de cada página");
      expect(t).toContain("Dependencias e integraciones");
      expect(t).toContain("Dominio, DNS y certificados");
      expect(t).toContain("con todos sus activos");
      expect(await projectRow(first.id)).toMatchObject({ solutions: ["tienda online (e-commerce)"], techs: ["Shopify", "Klaviyo"], initialImprovement: true });
      expect(await projectRow(second.id)).toMatchObject({ solutions: ["aplicación móvil iOS", "chatbot"], services: ["server", "deps", "domain", "security"], initialImprovement: false });
      const [n] = await log();
      expect(n).toMatchObject({ type: "welcome", status: "sent", projectId: first.id });
    });

    it("sin ningún servicio de visitas no promete el correo semanal", async () => {
      const { client, project } = await setup();
      await sendClientWelcome(client.id, form({ projectId: project.id, solutions: ["chatbot"], services: ["server", "security"] }), {}, db, deps());
      expect(sent[0]!.text).not.toContain("Cada lunes");
      expect(sent[0]!.text).toContain("Un correo al mes");
      expect(sent[0]!.text).not.toContain("Velocidad y calidad de cada página");
    });

    it("el recuadro de tranquilidad va siempre, antes de la tabla, y se repite junto al PIN", async () => {
      const { client, project } = await setup();
      await sendClientWelcome(client.id, form({ projectId: project.id }), {}, db, deps());
      const t = sent[0]!.text;
      expect(t).toContain("SI VES NÚMEROS BAJOS, NO TE ALARMES");
      expect(t.indexOf("SI VES NÚMEROS BAJOS")).toBeLessThan(t.indexOf("No tienes que hacer nada"));
      expect(t).toContain("Recuerda: si en el portal ves valores por debajo de la meta, son el punto de partida");
      expect(t).toContain("Todo lo que sostiene un activo digital caduca");
      expect(t).toContain("observabilidad en todas las capas");
      expect(t).toContain("OWASP");
    });

    it("la nota de fin de soporte sale de cualquiera de las tecnologías y queda como ejemplo", async () => {
      const { client, project } = await setup();
      await sendClientWelcome(client.id, form({ projectId: project.id, techs: ["Flutter", "Laravel", "MySQL"] }), {}, db, deps());
      expect(sent[0]!.text).toContain("(por ejemplo, PHP 8.2 deja de recibir parches de seguridad el 31 de diciembre de 2026)");
    });

    it("limpia lo escrito a mano: recorta, quita vacíos y repetidos", async () => {
      const { client, project } = await setup();
      await sendClientWelcome(client.id, form({ projectId: project.id, solutions: ["  Marketplace ", "marketplace", ""], techs: ["Next.js", " next.js ", "  "] }), {}, db, deps());
      expect(await projectRow(project.id)).toMatchObject({ solutions: ["Marketplace"], techs: ["Next.js"] });
    });

    it("rechaza lo que no cuadra: un producto ajeno, repetido o en desarrollo; textos con signos peligrosos o demasiados", async () => {
      const { client, first } = await twoProducts();
      const other = await setup("production", { name: "Otro" });
      const base = { solutions: ["sitio"], techs: [], services: ["web"], initialImprovement: false };
      await expect(sendClientWelcome(client.id, { products: [{ projectId: other.project.id, ...base }], ccText: "" }, {}, db, deps())).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(sendClientWelcome(client.id, { products: [{ projectId: first.id, ...base }, { projectId: first.id, ...base }], ccText: "" }, {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
      await expect(sendClientWelcome(client.id, { products: [], ccText: "" }, {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
      await expect(sendClientWelcome(client.id, { products: [{ projectId: first.id, ...base, solutions: ["<script>"] }], ccText: "" }, {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
      const many = Array.from({ length: 13 }, (_, i) => `Tec ${i}`);
      await expect(sendClientWelcome(client.id, { products: [{ projectId: first.id, ...base, techs: many }], ccText: "" }, {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
      await db.update(s.projects).set({ phase: "development" }).where(eq(s.projects.id, first.id));
      await expect(sendClientWelcome(client.id, { products: [{ projectId: first.id, ...base }], ccText: "" }, {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
      expect(sent).toHaveLength(0);
    });
  });

  it("guarda lo del formulario para los próximos envíos y anota el envío", async () => {
    const { client, project } = await setup();
    await sendClientWelcome(client.id, form({ projectId: project.id, solutions: ["tienda online"], techLabel: "Shopify", includesServer: false, initialImprovement: true, ccText: "Luis <luis@aurora.test>" }), {}, db, deps());
    expect(await projectRow(project.id)).toMatchObject({ solutions: ["tienda online"], techs: ["Shopify"], services: ["web", "seo", "security"], initialImprovement: true });
    const c = await clientRow(client.id);
    expect(c.ccContacts).toEqual([{ name: "Luis", email: "luis@aurora.test" }]);
    expect(c.welcomeSentAt).toEqual(clock);
    const [n] = await log();
    expect(n).toMatchObject({ type: "welcome", status: "sent", clientId: client.id, projectId: project.id });
    expect(n!.recipient).toBe("ana@aurora.test, luis@aurora.test");
    // La tienda en Shopify: sin servidor y sin nota de versiones.
    expect(sent[0]!.text).toContain("tienda online en Shopify");
    expect(sent[0]!.text).not.toContain("Servidor, servicios y APIs");
    expect(sent[0]!.text).not.toContain("PHP 8.2");
    expect(sent[0]!.text).toContain("Todo lo que sostiene un activo digital caduca");
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
    expect(await projectRow(project.id)).toMatchObject({ techs: ["Next.js"] });
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
    expect((await projectRow(project.id)).techs).toEqual([]);
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
    await expect(sendClientWelcome(client.id, form({ projectId: project.id, solutions: [] }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
    await expect(sendClientWelcome(client.id, form({ projectId: project.id, services: [] }), {}, db, deps())).rejects.toMatchObject({ code: "INVALID" });
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
