import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";
import { createMailer, withDisplayName } from "@/server/notify/mailer";
import {
  DEFAULT_SENDER,
  normalizePhone,
  PhoneError,
  senderFromAdmin,
  senderMailFields,
  type SenderAdmin,
} from "@/server/domain/client-sender";

const luis: SenderAdmin = { firstName: "Luis", lastName: "Porteles", email: "luis@x.test", phone: "+1 555 010 0000", role: "admin" };

describe("quién firma", () => {
  it("toma el nombre, el WhatsApp y el correo de la cuenta responsable", () => {
    expect(senderFromAdmin(luis)).toEqual({ name: "Luis Porteles", brand: "zipnegocios", service: "Informes técnicos web", whatsapp: "+1 555 010 0000", email: "luis@x.test" });
  });
  it("sin nombre usa el correo, para no firmar con un nombre inventado", () => {
    expect(senderFromAdmin({ ...luis, firstName: null, lastName: null }).name).toBe("luis@x.test");
    expect(senderFromAdmin({ ...luis, firstName: "Luis", lastName: null }).name).toBe("Luis");
  });
  it("un administrador sin teléfono no muestra WhatsApp; la cuenta propietaria conserva el de siempre", () => {
    expect(senderFromAdmin({ ...luis, phone: null }).whatsapp).toBeNull();
    expect(senderFromAdmin({ ...luis, phone: "  " }).whatsapp).toBeNull();
    expect(senderFromAdmin({ ...luis, role: "owner", phone: null }).whatsapp).toBe(DEFAULT_SENDER.whatsapp);
    expect(senderFromAdmin({ ...luis, role: "owner", phone: "+1 999 000 1111" }).whatsapp).toBe("+1 999 000 1111");
  });
  it("el correo sale a nombre del responsable y las respuestas le llegan a él", () => {
    expect(senderMailFields(senderFromAdmin(luis))).toEqual({ fromName: "Luis Porteles", replyTo: "luis@x.test" });
    expect(senderMailFields(DEFAULT_SENDER)).toEqual({ fromName: "Gustavo Amarista" });
  });
});

describe("teléfono", () => {
  it("acepta formatos habituales y deja vacío como ausente", () => {
    expect(normalizePhone("+1 316 469 5701")).toBe("+1 316 469 5701");
    expect(normalizePhone("  (316) 469-5701 ")).toBe("(316) 469-5701");
    expect(normalizePhone("")).toBeNull();
  });
  it("rechaza lo que no es un teléfono", () => {
    expect(() => normalizePhone("hola")).toThrow(PhoneError);
    expect(() => normalizePhone("12345")).toThrow(PhoneError);
    expect(() => normalizePhone("+1 <script>")).toThrow(PhoneError);
  });
});

describe("remitente del correo", () => {
  it("cambia solo el nombre visible, nunca la dirección, y limpia lo que rompería la cabecera", () => {
    expect(withDisplayName("Gustavo Amarista <no-reply@x.test>", "Luis Porteles")).toBe('"Luis Porteles" <no-reply@x.test>');
    expect(withDisplayName("no-reply@x.test", "Luis")).toBe('"Luis" <no-reply@x.test>');
    expect(withDisplayName("Gustavo <a@x.test>", 'Luis "El" <evil@x.test>\r\nBcc: z@x.test')).toBe('"Luis El evil@x.testBcc: z@x.test" <a@x.test>');
    expect(withDisplayName("Gustavo <a@x.test>", "  ")).toBe("Gustavo <a@x.test>");
  });
  it("el correo sale con el nombre y el Reply-To del responsable", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    const mailer = createMailer({ host: "h", port: 587, from: "Gustavo Amarista <no-reply@x.test>", replyTo: "gustavo@x.test" }, transport);
    let raw = "";
    const orig = transport.sendMail.bind(transport);
    transport.sendMail = (async (m: never) => { const info = await orig(m); raw = (info as unknown as { message: Buffer }).message.toString("utf8"); return info; }) as never;
    await mailer.send({ to: "a@x.test", subject: "S", text: "t", html: "<p>t</p>", fromName: "Luis Porteles", replyTo: "luis@x.test" });
    expect(raw).toContain("From: Luis Porteles <no-reply@x.test>");
    expect(raw).toContain("Reply-To: luis@x.test");
    expect(raw).not.toContain("gustavo@x.test");
    await mailer.send({ to: "a@x.test", subject: "S", text: "t", html: "<p>t</p>" });
    expect(raw).toContain("From: Gustavo Amarista <no-reply@x.test>");
    expect(raw).toContain("Reply-To: gustavo@x.test");
  });
});
