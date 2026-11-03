import { env } from "@/server/config/env";
import { createMailer, type Mailer } from "./mailer";

/** Envío SMTP con la configuración del servicio web. */
export function webMailer(): Mailer {
  const e = env();
  return createMailer({ host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER || undefined, pass: e.SMTP_PASS || undefined, from: e.EMAIL_FROM });
}
