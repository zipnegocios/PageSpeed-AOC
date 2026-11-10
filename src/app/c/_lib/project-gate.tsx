import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { portalProjectPath } from "@/lib/urls";
import { getPortalOverview, getPortalProject, type PortalClient, type PortalProject } from "@/server/services/portal";
import { BlockedNotice } from "../_components/blocked-notice";
import { PinGateFor } from "../_components/pin-gate";
import { SuspendedNotice } from "../_components/suspended-notice";
import { portalAccess } from "./access";

export type ProjectGate =
  /** El acceso no está resuelto (PIN, bloqueo, suspensión): se muestra este aviso en lugar de la pantalla. */
  | { kind: "notice"; element: ReactNode }
  | { kind: "ok"; token: string; client: PortalClient; project: PortalProject; base: string; several: boolean };

/**
 * La puerta de cualquier pantalla de un proyecto del portal: acceso del enlace, PIN y pertenencia del proyecto al
 * cliente. Se comprueba en el layout y otra vez en cada página (una navegación entre pestañas no vuelve a ejecutar el
 * layout), y `cache` evita repetir las consultas dentro de una misma petición.
 */
export const loadProjectGate = cache(async (token: string, projectId: string): Promise<ProjectGate> => {
  const access = await portalAccess(token);
  if (access.state === "blocked") return { kind: "notice", element: <BlockedNotice /> };
  if (access.state === "suspended") return { kind: "notice", element: <SuspendedNotice clientName={access.clientName} /> };
  if (access.state === "legacy") notFound();
  if (access.state === "pin") return { kind: "notice", element: <PinGateFor slug={token} /> };
  const project = await getPortalProject(access.client.id, projectId);
  if (!project) notFound();
  const several = (await getPortalOverview(access.client.id)).length > 1;
  return { kind: "ok", token, client: access.client, project, base: portalProjectPath(token, project.slug), several };
});
