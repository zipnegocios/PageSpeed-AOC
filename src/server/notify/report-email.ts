import type { ClientSender } from "@/server/domain/client-sender";
import { givenName } from "@/server/domain/client-welcome";
import { PERIOD_LABEL, type Period } from "@/server/domain/history";
import { composeClientEmail, voice, type ClientEmail } from "./client-emails";

/**
 * Correo que acompaña a los dos informes PDF (resumen e ingeniería) cuando se envían a mano. Firma tu nombre. Con una
 * persona habla de «tú»; con varias, de «ustedes».
 */
export function buildReportEmail(input: {
  contactName: string | null;
  names?: string[];
  clientName?: string;
  projectName: string;
  days: Period;
  portalUrl: string;
  sender: ClientSender;
  appUrl: string;
}): ClientEmail {
  const names = input.names ?? (input.contactName?.trim() ? [givenName(input.contactName)] : []);
  const T = voice(names);
  const period = PERIOD_LABEL[input.days];
  return composeClientEmail({
    subject: `Informes técnicos web · ${input.projectName}`,
    preview: `Los informes de ${input.projectName} de los últimos ${period}, en PDF.`,
    names,
    clientName: input.clientName ?? "",
    sender: input.sender,
    appUrl: input.appUrl,
    blocks: [
      { k: "p", t: `${T("Te adjunto", "Les adjunto")} los informes de **${input.projectName}** con las auditorías de los últimos ${period}, en PDF:` },
      {
        k: "list",
        items: [
          `**Informe resumen:** el estado de ${T("tu", "su")} sitio en pocas páginas, en lenguaje claro.`,
          "**Informe de ingeniería:** el detalle técnico de cada página, medición por medición.",
        ],
      },
      { k: "p", t: `${T("También puedes ver", "También pueden ver")} siempre el estado actualizado en ${T("tu", "su")} portal:` },
      { k: "buttons", items: [{ label: "Abrir el portal", url: input.portalUrl }] },
    ],
  });
}
