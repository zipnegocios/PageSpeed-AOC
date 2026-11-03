import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";
import { createMailer } from "@/server/notify/mailer";
import { parseWorkerEnv } from "@/server/config/env";

describe("createMailer", () => {
  it("envía con el remitente configurado", async () => {
    const transport = createTransport({ jsonTransport: true });
    const mailer = createMailer({ host: "h", port: 465, from: "AOC <n@x.test>" }, transport);
    await expect(mailer.send({ to: "a@x.test", subject: "Asunto", text: "t", html: "<p>t</p>" })).resolves.toBeUndefined();
  });

  it("adjunta archivos con su nombre y tipo", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    const mailer = createMailer({ host: "h", port: 587, from: "AOC <n@x.test>" }, transport);
    let raw = "";
    const orig = transport.sendMail.bind(transport);
    transport.sendMail = (async (m: never) => { const info = await orig(m); raw = (info as unknown as { message: Buffer }).message.toString("utf8"); return info; }) as never;
    await mailer.send({ to: "a@x.test", subject: "Informe", text: "t", html: "<p>t</p>", attachments: [{ filename: "informe.pdf", content: Buffer.from("%PDF-1.7 x"), contentType: "application/pdf" }] });
    expect(raw).toContain("Content-Type: application/pdf");
    expect(raw).toMatch(/filename=(")?informe\.pdf/);
    expect(raw).toContain("From: AOC <n@x.test>");
  });

  it("propaga el error del transporte", async () => {
    const transport = createTransport({ jsonTransport: true });
    transport.sendMail = (async () => { throw new Error("rechazado"); }) as never;
    await expect(createMailer({ host: "h", port: 587, from: "f@x.test" }, transport).send({ to: "a", subject: "s", text: "t", html: "h" })).rejects.toThrow("rechazado");
  });
});

describe("entorno del worker y correo", () => {
  const base = {
    DATABASE_URL: "postgres://x", REDIS_URL: "redis://x", R2_ENDPOINT: "https://r2.test", R2_BUCKET: "b",
    R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "s",
  };
  it("el SMTP es opcional en el worker", () => {
    const env = parseWorkerEnv(base);
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
    expect(env.ALERT_EMAIL).toBeUndefined();
  });
  it("lee SMTP, remitente, URL pública y destinatario; ALERT_EMAIL vacío equivale a no definido", () => {
    const env = parseWorkerEnv({ ...base, SMTP_HOST: "smtp.x.test", SMTP_PORT: "465", EMAIL_FROM: "AOC <n@x.test>", APP_URL: "https://app.x.test", ALERT_EMAIL: "" });
    expect(env).toMatchObject({ SMTP_HOST: "smtp.x.test", SMTP_PORT: 465, EMAIL_FROM: "AOC <n@x.test>", APP_URL: "https://app.x.test" });
    expect(env.ALERT_EMAIL).toBeUndefined();
    expect(parseWorkerEnv({ ...base, ALERT_EMAIL: "alertas@x.test" }).ALERT_EMAIL).toBe("alertas@x.test");
    expect(() => parseWorkerEnv({ ...base, ALERT_EMAIL: "no-es-correo" })).toThrow(/ALERT_EMAIL/);
  });
});
