/** A quién escribe un cliente suspendido. Cambiar estos datos cambia el aviso del portal. */
export const SUPPORT_CONTACT = {
  name: "Gustavo Amarista",
  brand: "zipnegocios",
  handle: "@zipnegocios",
  whatsapp: "+1 316 469 5701",
} as const;

/** Mensaje ya escrito para reactivar el servicio. */
export function reactivationMessage(clientName: string): string {
  return `Hola ${SUPPORT_CONTACT.name}, soy de ${clientName}. Mi portal de informes de PageSpeed aparece suspendido y quiero reactivarlo.`;
}
