import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { parseSeoPeriod } from "@/server/domain/seo-data";
import { getPortalTraffic } from "@/server/services/portal-traffic";
import { PortalPage } from "../../../_components/portal-page";
import { PortalTrafficView, parseTrafficSection, type TrafficSection } from "../../../_components/traffic";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Tráfico y búsqueda"), robots: { index: false, follow: false } };

export default async function PortalTraffic({ params, searchParams }: { params: Promise<{ token: string; projectId: string }>; searchParams: Promise<{ periodo?: string | string[]; seccion?: string | string[] }> }) {
  const { token, projectId } = await params;
  const search = await searchParams;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, client, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/trafico`);
  // Solo si el administrador lo activó para este proyecto y hay datos conectados o un rastreo; si no, el servicio devuelve null.
  const days = parseSeoPeriod(search.periodo);
  const data = await getPortalTraffic(client.id, project, { days });
  // La sección pedida debe existir; si no, la primera disponible.
  const wanted = parseTrafficSection(search.seccion);
  const available: TrafficSection[] = data ? [...(data.dashboard ? (["visitas", "google"] as const) : []), ...(data.health ? (["salud"] as const) : [])] : [];
  const section = wanted && available.includes(wanted) ? wanted : (available[0] ?? "visitas");
  return (
    <PortalPage title="Tráfico y búsqueda" subtitle="Cómo te encuentran y cuánta gente llega a tu sitio.">
      {data ? (
        <PortalTrafficView data={data} section={section} basePath={`${base}/trafico`} />
      ) : (
        <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Aún no hay datos de tráfico y búsqueda para este proyecto. Aparecerán aquí cuando se conecten.</p>
      )}
    </PortalPage>
  );
}
