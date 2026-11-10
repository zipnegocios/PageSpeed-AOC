import type { ReactNode } from "react";
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
      projectName={gate.project.name}
      several={gate.several}
      badges={{ mejoras: gate.project.improvements.length }}
    >
      {children}
    </PortalChrome>
  );
}
