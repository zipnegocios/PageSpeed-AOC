import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import {
  ccAddresses,
  CcParseError,
  endOfSupportNote,
  greetingNames,
  isProjectKind,
  parseCcContacts,
  PROJECT_KIND_LABEL,
  siteLabel,
} from "@/server/domain/client-welcome";
import { generatePin, hashPin } from "@/server/domain/portal-pin";
import { buildWelcomeEmail } from "@/server/notify/client-emails";
import type { Mailer } from "@/server/notify/mailer";
import { webMailer } from "@/server/notify/web-mailer";
import { insertNotification } from "@/server/repositories/alerts";
import { findClient, setClientCc, setClientPinRow, setWelcomeSent } from "@/server/repositories/clients";
import { findProject, setProjectEmailProfile } from "@/server/repositories/projects";
import { requiredText } from "@/server/validation/common";
import { readStoredPin, type PinDeps } from "./portal-pin";
import { assertUuid, parseInput } from "./shared";
import { encryptJson } from "@/server/crypto/secret-box";

/** Mínimo entre dos bienvenidas del mismo cliente, para no repetirla por un doble clic. */
export const WELCOME_COOLDOWN_MS = 5 * 60_000;

export type WelcomeDeps = PinDeps & { mailer?: Mailer };

const welcomeInput = z.object({
  projectId: z.string(),
  kind: z.string().refine(isProjectKind, { error: "Elige si es un sitio, una tienda o una aplicación." }),
  techLabel: requiredText("La tecnología", 2, 60),
  includesServer: z.boolean(),
  ccText: z.string().max(4000, { error: "La lista de personas en copia es demasiado larga." }),
});

export type WelcomeInput = z.input<typeof welcomeInput>;

export type WelcomeResult = {
  to: string;
  cc: string[];
  /** true si era una prueba al administrador: no se tocó nada del cliente. */
  test: boolean;
  /** true si se generó un PIN nuevo (el cliente no tenía uno que se pudiera mostrar). */
  newPin: boolean;
};

function sealPin(pin: string, deps: PinDeps): Buffer | null {
  try {
    return encryptJson(pin, deps.authKey ?? process.env.AUTH_ENCRYPTION_KEY);
  } catch {
    return null;
  }
}

function secretOf(deps: PinDeps): string {
  const value = deps.secret ?? process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET no está definida o tiene menos de 32 caracteres");
  return value;
}

/**
 * Envía la bienvenida a un cliente: un solo correo para el contacto principal, con copia al resto del equipo. Guarda lo
 * que se pidió en el formulario (tecnología, tipo, servidor y personas en copia) para los envíos siguientes.
 *
 * Con `testTo`, es una prueba: el mismo correo, con los mismos datos, solo para esa dirección. No guarda nada, no toca
 * el PIN ni anota el envío.
 *
 * El PIN: se usa el último generado si se puede mostrar; si no, se genera uno nuevo (y solo se activa si el correo
 * salió, para no dejar al cliente sin acceso).
 */
export async function sendClientWelcome(
  clientId: string,
  raw: WelcomeInput,
  opts: { testTo?: string } = {},
  db: Database = getDb(),
  deps: WelcomeDeps = {},
): Promise<WelcomeResult> {
  assertUuid(clientId, "Cliente");
  const now = (deps.now ?? (() => new Date()))();
  const test = Boolean(opts.testTo);
  const client = await findClient(db, clientId);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  const primary = client.contactEmail?.trim();
  if (!primary && !test) throw new DomainError("INVALID", "Este cliente no tiene correo de contacto. Agrégalo en su ficha para poder enviarle la bienvenida.");
  if (client.status !== "active" && !test) throw new DomainError("INVALID", "El cliente está suspendido. Reactívalo antes de enviarle la bienvenida.");

  const input = parseInput(welcomeInput, raw);
  assertUuid(input.projectId, "Proyecto");
  const project = await findProject(db, input.projectId);
  if (!project || project.clientId !== client.id) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  if (project.phase !== "production") throw new DomainError("INVALID", "El proyecto debe estar en producción: el portal del cliente solo muestra proyectos en producción.");

  let cc;
  try {
    cc = parseCcContacts(input.ccText, primary ? [primary] : []);
  } catch (err) {
    if (err instanceof CcParseError) throw new DomainError("INVALID", err.message);
    throw err;
  }

  if (!test && client.welcomeSentAt && now.getTime() - client.welcomeSentAt.getTime() < WELCOME_COOLDOWN_MS) {
    throw new DomainError("CONFLICT", "La bienvenida de este cliente ya se envió hace unos minutos. Espera un poco antes de reenviarla.");
  }

  const kind = input.kind as "site" | "shop" | "app";
  const techLabel = input.techLabel;

  // Lo del formulario se guarda antes de enviar: si el correo falla, no hay que volver a escribirlo.
  if (!test) {
    await setProjectEmailProfile(db, project.id, { kind, techLabel, includesServer: input.includesServer });
    await setClientCc(db, client.id, cc);
  }

  const base = (deps.appUrl ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const stored = client.pinHash ? readStoredPin(client, deps) : null;
  const newPin = !test && !stored;
  const pin = stored ?? (test ? "000000" : generatePin());

  const mail = buildWelcomeEmail({
    names: greetingNames(client.contactName, cc),
    clientName: client.name,
    site: siteLabel(project.baseUrl),
    portalUrl: `${base}/c/${client.slug}`,
    kind: PROJECT_KIND_LABEL[kind],
    techLabel,
    includesServer: input.includesServer,
    eolNote: endOfSupportNote(techLabel, now),
    pin,
  });

  const to = test ? opts.testTo! : primary!;
  const ccTo = test ? [] : ccAddresses(cc, primary);
  const subject = test ? `[PRUEBA] ${mail.subject}` : mail.subject;
  const record = {
    projectId: project.id,
    clientId: client.id,
    type: "welcome" as const,
    recipient: [to, ...ccTo].join(", "),
    subject,
    sentAt: now,
  };
  try {
    await (deps.mailer ?? webMailer()).send({ to, ...(ccTo.length > 0 ? { cc: ccTo } : {}), ...mail, subject });
  } catch (err) {
    if (!test) {
      const e = err as { code?: unknown; message?: unknown };
      const detail = `${typeof e?.code === "string" ? `${e.code}: ` : ""}${typeof e?.message === "string" ? e.message.replace(/\s+/g, " ").slice(0, 160) : "error desconocido"}`;
      await insertNotification(db, { ...record, status: "failed", error: detail });
    }
    throw new DomainError("UPSTREAM", "No se pudo enviar el correo. Revisa la configuración SMTP e inténtalo de nuevo.");
  }

  if (!test) {
    // Solo ahora se activa el PIN nuevo: si el correo hubiera fallado, el cliente conserva el que ya tenía.
    if (newPin) await setClientPinRow(db, client.id, hashPin(client.id, pin, secretOf(deps)), now, sealPin(pin, deps));
    await setWelcomeSent(db, client.id, now);
    await insertNotification(db, { ...record, status: "sent" });
  }
  return { to, cc: ccTo, test, newPin };
}
