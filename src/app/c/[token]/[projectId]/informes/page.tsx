import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { PortalPage } from "../../../_components/portal-page";
import { ReportCards, ReportPeriodSwitch, parseReportPeriod } from "../../../_components/report-cards";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Informes"), robots: { index: false, follow: false } };

export default async function PortalReports({ params, searchParams }: { params: Promise<{ token: string; projectId: string }>; searchParams: Promise<{ dias?: string | string[] }> }) {
  const { token, projectId } = await params;
  const search = await searchParams;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/informes`);
  const days = parseReportPeriod(search.dias);
  return (
    <PortalPage title="Informes" subtitle="Descarga tus informes en PDF, con el logotipo de tu empresa y la fecha. Los dos también te llegan adjuntos al correo.">
      <ReportPeriodSwitch base={base} days={days} />
      <ReportCards base={base} days={days} />
    </PortalPage>
  );
}
