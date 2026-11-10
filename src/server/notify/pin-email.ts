import { givenName } from "@/server/domain/client-welcome";
import { composeClientEmail, voice, type ClientEmail } from "./client-emails";

/**
 * Correo con el PIN nuevo del portal. Firma tu nombre (ver `CLIENT_SENDER`). Con una persona habla de «tú»; con varias, de
 * «ustedes», y le llega a todo el equipo (contacto principal y copia).
 */
export function buildPinEmail(input: { contactName: string | null; names?: string[]; clientName: string; pin: string; portalUrl: string }): ClientEmail {
  const names = input.names ?? (input.contactName?.trim() ? [givenName(input.contactName)] : []);
  const T = voice(names);
  return composeClientEmail({
    subject: T("Tu PIN para ver tu informe", "Su PIN para ver su informe"),
    preview: "El PIN nuevo para entrar al portal.",
    names,
    clientName: input.clientName,
    blocks: [
      { k: "p", t: `Este es ${T("tu", "el")} PIN nuevo para entrar al portal de ${input.clientName}. Los PIN anteriores dejan de funcionar.` },
      { k: "pin", pin: input.pin },
      { k: "buttons", items: [{ label: "Abrir el portal", url: input.portalUrl }] },
      { k: "fine", t: T("Si no lo pediste tú, puedes ignorar este correo.", "Si nadie lo pidió, pueden ignorar este correo. Es el mismo acceso para todo el equipo.") },
    ],
  });
}
