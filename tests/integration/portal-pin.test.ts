import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Mailer, MailMessage } from "@/server/notify/mailer";
import * as clients from "@/server/services/clients";
import { generateClientPin, PIN_REQUEST_COOLDOWN_MS, readStoredPin, requestPinByEmail, verifyClientPin } from "@/server/services/portal-pin";

const dbUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(40);
const AUTH_KEY = Buffer.alloc(32, 7).toString("base64");

describe.skipIf(!dbUrl)("PIN del portal", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let sent: MailMessage[] = [];
  let failMail = false;
  const mailer: Mailer = {
    send: async (m) => {
      if (failMail) throw new Error("SMTP caído");
      sent.push(m);
    },
  };
  let clock = new Date("2026-11-03T12:00:00Z");
  const deps = () => ({ mailer, secret: SECRET, authKey: AUTH_KEY, appUrl: "https://app.test/", now: () => clock });
  const pinIn = (m: MailMessage) => /PIN: (\d{6})/.exec(m.text)![1]!;

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    sent = [];
    failMail = false;
    clock = new Date("2026-11-03T12:00:00Z");
  });
  const newClient = (extra: Record<string, string> = {}) => clients.createClient({ name: "Acme", contactName: "Ana", contactEmail: "ana@acme.test", ...extra }, db);
  const row = async (id: string) => (await db.select().from(s.clients).where(sql`id = ${id}`))[0]!;

  describe("desde el panel", () => {
    it("genera un PIN de 6 dígitos, guarda solo su huella y sube la versión", async () => {
      const c = await newClient();
      const { pin, emailed } = await generateClientPin(c.id, {}, db, deps());
      expect(pin).toMatch(/^\d{6}$/);
      expect(emailed).toBe(false);
      const r = await row(c.id);
      expect(r.pinVersion).toBe(1);
      expect(r.pinHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain(pin);
      expect(r.pinUpdatedAt).toEqual(clock);
      expect(sent).toHaveLength(0);
      expect((await verifyClientPin(c.slug, pin, db, deps())).ok).toBe(true);
    });

    it("otro PIN anula el anterior y cambia la versión (las sesiones abiertas dejan de valer)", async () => {
      const c = await newClient();
      const first = (await generateClientPin(c.id, {}, db, deps())).pin;
      let second = first;
      while (second === first) second = (await generateClientPin(c.id, {}, db, deps())).pin;
      expect((await verifyClientPin(c.slug, first, db, deps())).ok).toBe(false);
      expect((await verifyClientPin(c.slug, second, db, deps())).ok).toBe(true);
      expect((await row(c.id)).pinVersion).toBeGreaterThanOrEqual(2);
    });

    it("con correo: lo envía al contacto con el PIN y el enlace del portal", async () => {
      const c = await newClient();
      const { pin, to } = await generateClientPin(c.id, { email: true }, db, deps());
      expect(to).toBe("ana@acme.test");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "ana@acme.test", subject: "Tu PIN para ver tu informe" });
      expect(pinIn(sent[0]!)).toBe(pin);
      expect(sent[0]!.text).toContain("https://app.test/c/acme");
    });

    it("el PIN nuevo le llega a todo el equipo: contacto principal y personas en copia, con un saludo para todos", async () => {
      const c = await newClient();
      await db
        .update(s.clients)
        .set({ ccContacts: [{ name: "Luis Vega", email: "luis@acme.test" }, { name: "Ana María Osorio", email: "ana@acme.test" }] })
        .where(sql`id = ${c.id}`);
      await generateClientPin(c.id, { email: true }, db, deps());
      expect(sent[0]).toMatchObject({ to: "ana@acme.test", cc: ["luis@acme.test"], subject: "Su PIN para ver su informe" });
      expect(sent[0]!.text).toContain("Hola Ana, Luis y Ana María,");
      expect(sent[0]!.text).toContain("Gustavo Amarista");
    });

    it("si el correo falla, el PIN anterior sigue valiendo", async () => {
      const c = await newClient();
      const { pin } = await generateClientPin(c.id, {}, db, deps());
      failMail = true;
      await expect(generateClientPin(c.id, { email: true }, db, deps())).rejects.toThrow(/No se pudo enviar el correo/);
      expect((await verifyClientPin(c.slug, pin, db, deps())).ok).toBe(true);
      expect((await row(c.id)).pinVersion).toBe(1);
    });

    it("sin correo de contacto, enviar falla con un mensaje claro y no cambia nada", async () => {
      const c = await clients.createClient({ name: "Sin Correo" }, db);
      await expect(generateClientPin(c.id, { email: true }, db, deps())).rejects.toThrow(/no tiene correo/);
      expect((await row(c.id)).pinHash).toBeNull();
    });
  });

  describe("último PIN visible en el panel", () => {
    it("guarda el PIN cifrado y se puede leer con la clave; el dato en la base no contiene el PIN", async () => {
      const c = await newClient();
      const { pin } = await generateClientPin(c.id, {}, db, deps());
      const r = await row(c.id);
      expect(r.pinEnc).toBeInstanceOf(Buffer);
      expect(r.pinEnc!.toString("utf8")).not.toContain(pin);
      expect(readStoredPin(r, deps())).toBe(pin);
    });

    it("siempre es el último: uno nuevo (del panel o pedido por correo) reemplaza al anterior", async () => {
      const c = await newClient();
      await generateClientPin(c.id, {}, db, deps());
      const second = (await generateClientPin(c.id, { email: true }, db, deps())).pin;
      expect(readStoredPin(await row(c.id), deps())).toBe(second);
      clock = new Date(clock.getTime() + PIN_REQUEST_COOLDOWN_MS + 1000);
      await requestPinByEmail("acme", db, deps());
      expect(readStoredPin(await row(c.id), deps())).toBe(pinIn(sent.at(-1)!));
    });

    it("sin clave de cifrado el PIN funciona pero no se puede mostrar; con otra clave tampoco", async () => {
      const c = await newClient();
      const { pin } = await generateClientPin(c.id, {}, db, { ...deps(), authKey: undefined });
      const r = await row(c.id);
      expect(r.pinEnc).toBeNull();
      expect(readStoredPin(r, deps())).toBeNull();
      expect((await verifyClientPin("acme", pin, db, deps())).ok).toBe(true);
      await generateClientPin(c.id, {}, db, deps());
      expect(readStoredPin(await row(c.id), { ...deps(), authKey: Buffer.alloc(32, 9).toString("base64") })).toBeNull();
    });

    it("un cliente con PIN anterior a esta función (sin dato guardado) devuelve null", async () => {
      expect(readStoredPin({ pinEnc: null })).toBeNull();
    });
  });

  describe("verificar", () => {
    it("acepta el PIN correcto por identificador (también el anterior) y rechaza lo demás", async () => {
      const c = await newClient();
      const { pin } = await generateClientPin(c.id, {}, db, deps());
      const wrong = pin === "000000" ? "000001" : "000000";
      expect((await verifyClientPin("acme", pin, db, deps())).ok).toBe(true);
      expect((await verifyClientPin("acme", wrong, db, deps())).ok).toBe(false);
      expect((await verifyClientPin("acme", "12345", db, deps())).ok).toBe(false);
      expect((await verifyClientPin("acme", "abcdef", db, deps())).ok).toBe(false);
      expect((await verifyClientPin("no-existe", pin, db, deps())).ok).toBe(false);
      expect((await verifyClientPin("../x", pin, db, deps())).ok).toBe(false);
      await clients.renameClientSlug(c.id, "acme-corp", db);
      expect((await verifyClientPin("acme", pin, db, deps())).ok).toBe(true);
    });

    it("un cliente sin PIN nunca entra, ni con 000000", async () => {
      await newClient();
      expect((await verifyClientPin("acme", "000000", db, deps())).ok).toBe(false);
    });

    it("un cliente archivado no entra", async () => {
      const c = await newClient();
      const { pin } = await generateClientPin(c.id, {}, db, deps());
      await clients.archiveClient(c.id, db);
      expect((await verifyClientPin("acme", pin, db, deps())).ok).toBe(false);
    });
  });

  describe("pedido por el propio cliente", () => {
    it("envía un PIN nuevo al correo de la ficha y desde ese momento solo vale el nuevo", async () => {
      const c = await newClient();
      const old = (await generateClientPin(c.id, {}, db, deps())).pin;
      expect(await requestPinByEmail("acme", db, deps())).toEqual({ sent: true });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe("ana@acme.test");
      const fresh = pinIn(sent[0]!);
      expect((await verifyClientPin("acme", fresh, db, deps())).ok).toBe(true);
      if (fresh !== old) expect((await verifyClientPin("acme", old, db, deps())).ok).toBe(false);
      expect((await row(c.id)).pinVersion).toBe(2);
    });

    it("sirve para estrenar el acceso de un cliente que aún no tenía PIN", async () => {
      await newClient();
      expect(await requestPinByEmail("acme", db, deps())).toEqual({ sent: true });
      expect((await verifyClientPin("acme", pinIn(sent[0]!), db, deps())).ok).toBe(true);
    });

    it("respeta el tiempo mínimo entre envíos y vuelve a enviar pasado ese tiempo", async () => {
      await newClient();
      expect((await requestPinByEmail("acme", db, deps())).sent).toBe(true);
      clock = new Date(clock.getTime() + PIN_REQUEST_COOLDOWN_MS - 1000);
      expect((await requestPinByEmail("acme", db, deps())).sent).toBe(false);
      expect(sent).toHaveLength(1);
      clock = new Date(clock.getTime() + 2000);
      expect((await requestPinByEmail("acme", db, deps())).sent).toBe(true);
      expect(sent).toHaveLength(2);
    });

    it("no revela nada: un cliente que no existe, suspendido, archivado o sin correo responde igual y no envía", async () => {
      expect(await requestPinByEmail("no-existe", db, deps())).toEqual({ sent: false });
      expect(await requestPinByEmail("../x", db, deps())).toEqual({ sent: false });
      const sus = await newClient({ name: "Acme" });
      await clients.setClientStatus(sus.id, "suspended", db);
      expect(await requestPinByEmail("acme", db, deps())).toEqual({ sent: false });
      await clients.createClient({ name: "Sin Correo" }, db);
      expect(await requestPinByEmail("sin-correo", db, deps())).toEqual({ sent: false });
      expect(sent).toHaveLength(0);
    });

    it("si el correo falla no cambia el PIN ni gasta el tiempo de espera", async () => {
      const c = await newClient();
      const { pin } = await generateClientPin(c.id, {}, db, deps());
      failMail = true;
      await expect(requestPinByEmail("acme", db, deps())).rejects.toThrow(/No se pudo enviar/);
      expect((await verifyClientPin("acme", pin, db, deps())).ok).toBe(true);
      expect((await row(c.id)).pinRequestedAt).toBeNull();
      failMail = false;
      expect((await requestPinByEmail("acme", db, deps())).sent).toBe(true);
    });
  });
});
