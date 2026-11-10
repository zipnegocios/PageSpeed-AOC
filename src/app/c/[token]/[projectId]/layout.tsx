import type { ReactNode } from "react";
import { portalLogoUrl } from "@/lib/ui/components/client-logo";
import { PortalChrome } from "../../_components/portal-chrome";
import { loadProjectGate } from "../../_lib/project-gate";

/** Marco persistente del informe de un proyecto (barra superior y pestañas). Las pantallas repiten la puerta de acceso. */
export default async function PortalProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  return (
    <PortalChrome
      token={token}
      base={gate.base}
      clientName={gate.client.name}
      logo={gate.client.logo ? { src: portalLogoUrl(token, gate.client.logo.icon ? "icon" : "full", gate.client.logo.v), bg: gate.client.logo.bg } : null}
      projectName={gate.project.name}
      several={gate.several}
      badges={{ mejoras: gate.project.improvements.length }}
    >
      {children}
    </PortalChrome>
  );
}
