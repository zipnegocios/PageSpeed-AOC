import { pageTitle } from "@/lib/brand";
import { Card } from "@/lib/ui/components/card";
import { PortalShell } from "./_components/portal-shell";

export const metadata = { title: pageTitle("Enlace no válido"), robots: { index: false, follow: false } };

export default function PortalNotFound() {
  return (
    <PortalShell title="Enlace no válido">
      <Card>
        <p className="text-ink">Este enlace no existe o dejó de estar activo. Pide a tu contacto que te envíe el enlace actual.</p>
      </Card>
    </PortalShell>
  );
}
