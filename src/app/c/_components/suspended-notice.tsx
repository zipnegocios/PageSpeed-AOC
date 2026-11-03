import { SUPPORT_CONTACT, reactivationMessage } from "@/lib/contact";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { buildWhatsappLink } from "@/server/notify/whatsapp-link";
import { PortalShell } from "./portal-shell";

/** Sustituye todos los datos cuando el cliente está suspendido, y dice a quién escribir para reactivarlo. */
export function SuspendedNotice({ clientName }: { clientName: string }) {
  const link = buildWhatsappLink(SUPPORT_CONTACT.whatsapp, reactivationMessage(clientName));
  return (
    <PortalShell clientName={clientName} title="Tu informe">
      <Card>
        <div>
          <Badge tone="danger">Servicio suspendido</Badge>
        </div>
        <p className="text-[19px] leading-6 text-ink">Tu servicio está suspendido. Para volver a ver tus auditorías, ponte en contacto con nosotros y lo reactivamos.</p>
        <p className="text-ink-muted">
          Contacto: <strong className="text-ink">{SUPPORT_CONTACT.name}</strong> · {SUPPORT_CONTACT.brand} ({SUPPORT_CONTACT.handle}) · {SUPPORT_CONTACT.whatsapp}
        </p>
        {link ? (
          <div>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-[17px] font-semibold text-on-primary hover:bg-primary-hover"
            >
              Escribir por WhatsApp
            </a>
          </div>
        ) : null}
      </Card>
    </PortalShell>
  );
}
