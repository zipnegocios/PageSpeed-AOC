import { createTransport, type Transporter } from "nodemailer";

export type MailAttachment = { filename: string; content: Buffer; contentType: string };
export type MailMessage = {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  /** Nombre que ve el cliente como remitente (la dirección es siempre la configurada). */
  fromName?: string;
  /** Adonde responde el cliente; si falta, el de la configuración. */
  replyTo?: string;
};
export type Mailer = { send(message: MailMessage): Promise<void> };

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  /** A dónde llegan las respuestas, si no es la dirección del remitente. */
  replyTo?: string;
};

/** El remitente configurado con otro nombre visible: `"Luis Porteles" <correo@dominio.com>`. La dirección no cambia. */
export function withDisplayName(from: string, name: string): string {
  const address = /<([^<>]+)>/.exec(from)?.[1]?.trim() ?? from.trim();
  const safe = name.replace(/["\r\n<>]/g, "").trim();
  return safe ? `"${safe}" <${address}>` : from;
}

/** Correo por SMTP. 465 usa TLS directo; el resto negocia STARTTLS si el servidor lo ofrece. */
export function createMailer(config: SmtpConfig, transport?: Transporter): Mailer {
  const t =
    transport ??
    createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  return {
    async send(message) {
      const { fromName, replyTo, ...rest } = message;
      const reply = replyTo ?? config.replyTo;
      await t.sendMail({ from: fromName ? withDisplayName(config.from, fromName) : config.from, ...(reply ? { replyTo: reply } : {}), ...rest });
    },
  };
}
