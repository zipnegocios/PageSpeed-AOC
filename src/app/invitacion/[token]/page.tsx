import type { Metadata } from "next";
import { PortalShell } from "@/app/c/_components/portal-shell";
import { pageTitle } from "@/lib/brand";
import { clientIp } from "@/lib/auth/client-ip";
import { inviteLimiter } from "@/lib/auth/invite-limiter";
import { Card } from "@/lib/ui/components/card";
import { previewInvite } from "@/server/services/team";
import { AcceptInviteForm } from "./invite-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Crea tu contraseña"), robots: { index: false, follow: false } };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = await clientIp();
  const preview = inviteLimiter.isBlocked(ip) ? null : await previewInvite(token);
  if (!preview) {
    // Desconocido, usado, vencido, revocado o bloqueado por intentos: el mismo mensaje en todos los casos.
    if (!inviteLimiter.isBlocked(ip)) inviteLimiter.recordFailure(ip);
    return (
      <PortalShell title="Invitación" plainFooter>
        <Card>
          <p className="text-ink">Este enlace no es válido o ya venció. Pide uno nuevo a quien te invitó.</p>
        </Card>
      </PortalShell>
    );
  }
  return (
    <PortalShell title={preview.kind === "reset" ? "Crea tu contraseña nueva" : "Crea tu contraseña"} subtitle="Con ella entrarás al panel." plainFooter>
      <Card>
        <AcceptInviteForm token={token} email={preview.email} />
      </Card>
    </PortalShell>
  );
}
