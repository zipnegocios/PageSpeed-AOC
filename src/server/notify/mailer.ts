import { createTransport, type Transporter } from "nodemailer";

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type Mailer = { send(message: MailMessage): Promise<void> };

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
};

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
      await t.sendMail({ from: config.from, ...message });
    },
  };
}
