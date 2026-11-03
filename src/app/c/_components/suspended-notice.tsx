import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { PortalShell } from "./portal-shell";

/** Sustituye todos los datos cuando el cliente está suspendido. */
export function SuspendedNotice({ clientName }: { clientName: string }) {
  return (
    <PortalShell clientName={clientName} title="Tu informe">
      <Card>
        <div>
          <Badge tone="danger">Servicio suspendido</Badge>
        </div>
        <p className="text-[19px] leading-6 text-ink">Tu servicio está suspendido. Renueva tu plan de soporte para volver a ver tus auditorías.</p>
        <p className="text-ink-muted">Si ya renovaste, escríbenos y lo reactivamos enseguida.</p>
      </Card>
    </PortalShell>
  );
}
