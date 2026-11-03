import { Card } from "@/lib/ui/components/card";
import { PortalShell } from "./portal-shell";

export function BlockedNotice() {
  return (
    <PortalShell title="Demasiados intentos">
      <Card>
        <p className="text-ink">Se han probado demasiados enlaces desde tu conexión. Espera unos minutos y vuelve a abrir el enlace que te enviamos.</p>
      </Card>
    </PortalShell>
  );
}
