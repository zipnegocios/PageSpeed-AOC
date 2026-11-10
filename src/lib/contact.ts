/** Marca y datos por defecto del aviso de servicio suspendido; el nombre y el WhatsApp salen del responsable de cada cliente. */
export const SUPPORT_CONTACT = {
  name: "Gustavo Amarista",
  brand: "zipnegocios",
  handle: "@zipnegocios",
  whatsapp: "+1 316 469 5701",
} as const;

/** Mensaje ya escrito para reactivar el servicio. */
export function reactivationMessage(clientName: string, contactName: string = SUPPORT_CONTACT.name): string {
  return `Hola ${contactName}, soy de ${clientName}. Mi portal de informes de PageSpeed aparece suspendido y quiero reactivarlo.`;
}
