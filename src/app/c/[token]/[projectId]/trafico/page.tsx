import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SeoDataSection } from "@/app/_components/seo/seo-data-section";
import type { HistorySearch } from "@/app/_components/history-panel";
import { pageTitle } from "@/lib/brand";
import { parseSeoPeriod } from "@/server/domain/seo-data";
import { getPortalSeoDashboard } from "@/server/services/seo-portal";
import { PortalPage } from "../../../_components/portal-page";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Tráfico y búsqueda"), robots: { index: false, follow: false } };

export default async function PortalTraffic({ params, searchParams }: { params: Promise<{ token: string; projectId: string }>; searchParams: Promise<HistorySearch> }) {
  const { token, projectId } = await params;
  const search = await searchParams;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, client, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/trafico`);
  // Solo si el administrador lo activó para este proyecto y tiene datos conectados; si no, el servicio devuelve null.
  const days = parseSeoPeriod(search.periodo);
  const seo = await getPortalSeoDashboard(client.id, project.id, { days, lang: Array.isArray(search.idioma) ? search.idioma[0] : search.idioma });
  return (
    <PortalPage title="Tráfico y búsqueda" subtitle="Cómo te encuentran y cuánta gente llega a tu sitio.">
      {seo ? (
        <SeoDataSection dashboard={seo} days={days} basePath={`${base}/trafico`} search={search} audience="client" />
      ) : (
        <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Aún no hay datos de tráfico y búsqueda para este proyecto. Aparecerán aquí cuando se conecten.</p>
      )}
    </PortalPage>
  );
}
