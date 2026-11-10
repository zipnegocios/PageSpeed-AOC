/**
 * Quién firma los correos de un cliente: su responsable (la persona que lo creó o a quien se reasignó). Lógica pura.
 *
 * Los clientes reconocen a la persona antes que a la marca: el nombre y el WhatsApp son los del responsable; «zipnegocios» y el
 * servicio son comunes porque los dos socios trabajan bajo la misma marca.
 */

export type SenderAdmin = {
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  role: string;
};

export type ClientSender = {
  /** Nombre y apellido tal como el cliente lo conoce. */
  name: string;
  brand: string;
  service: string;
  /** null si no tiene teléfono guardado: el pie no muestra el WhatsApp. */
  whatsapp: string | null;
  /** Adonde responde el cliente. null: lo decide la configuración del servicio. */
  email: string | null;
};

export const SENDER_BRAND_NAME = "zipnegocios";
export const SENDER_SERVICE_NAME = "Informes técnicos web";

/** La cuenta propietaria (Gustavo Amarista) cuando todavía no tiene su teléfono en el perfil. */
export const OWNER_FALLBACK = { name: "Gustavo Amarista", whatsapp: "+1 316 469 5701" } as const;

/** Quien firma si no hay ninguna cuenta (instalación sin administradores, pruebas). */
export const DEFAULT_SENDER: ClientSender = {
  name: OWNER_FALLBACK.name,
  brand: SENDER_BRAND_NAME,
  service: SENDER_SERVICE_NAME,
  whatsapp: OWNER_FALLBACK.whatsapp,
  email: null,
};

const fullName = (a: Pick<SenderAdmin, "firstName" | "lastName">) => [a.firstName, a.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

export function senderFromAdmin(admin: SenderAdmin): ClientSender {
  const phone = (admin.phone ?? "").trim();
  return {
    name: fullName(admin) || admin.email,
    brand: SENDER_BRAND_NAME,
    service: SENDER_SERVICE_NAME,
    // La cuenta propietaria conserva el WhatsApp de siempre mientras no ponga el suyo en el perfil.
    whatsapp: phone || (admin.role === "owner" ? OWNER_FALLBACK.whatsapp : null),
    email: admin.email,
  };
}

/** Lo que hay que pasar al mailer para que el correo salga a nombre del responsable y las respuestas lleguen a él. */
export function senderMailFields(sender: ClientSender): { fromName: string; replyTo?: string } {
  return { fromName: sender.name, ...(sender.email ? { replyTo: sender.email } : {}) };
}

// -------------------------------------------------------------- teléfono

/** Teléfono de contacto: cifras con espacios, guiones, paréntesis y un «+» inicial opcional. Devuelve null si va vacío. */
export function normalizePhone(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v) return null;
  if (!/^\+?[0-9 ()-]{6,24}$/.test(v) || (v.match(/[0-9]/g) ?? []).length < 6) throw new PhoneError("El teléfono no es válido. Usa solo números, espacios y un + al inicio, por ejemplo +1 555 010 0000.");
  return v;
}

export class PhoneError extends Error {}
