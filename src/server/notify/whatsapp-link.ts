/** Deja solo dígitos, sin "+" ni "00" internacional. null si no parece un teléfono (8 a 15 dígitos). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Enlace wa.me con el mensaje prellenado. null si no hay un teléfono válido. */
export function buildWhatsappLink(phone: string | null | undefined, message: string): string | null {
  const digits = normalizePhone(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

export type WhatsappAlert = { routePath: string; label: string };

/** Mensaje para avisar al cliente de lo detectado en su sitio. */
export function alertWhatsappMessage(input: {
  contactName?: string | null;
  projectName: string;
  alerts: WhatsappAlert[];
  /** Cuántas alertas hay en total (puede ser más que las listadas). */
  total?: number;
}): string {
  const greeting = input.contactName?.trim() ? `Hola ${input.contactName.trim()}` : "Hola";
  const shown = input.alerts.slice(0, 5);
  const total = input.total ?? input.alerts.length;
  const lines = shown.map((a) => `• ${a.routePath}: ${a.label}`);
  if (total > shown.length) lines.push(`• y ${total - shown.length} más`);
  return [
    `${greeting}, en la revisión automática de *${input.projectName}* detectamos puntos a corregir:`,
    "",
    ...lines,
    "",
    "Podemos encargarnos de la corrección. ¿Te parece si lo coordinamos?",
  ].join("\n");
}
