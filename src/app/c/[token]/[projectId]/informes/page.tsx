import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { PortalPage } from "../../../_components/portal-page";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Informes"), robots: { index: false, follow: false } };

export default async function PortalReports({ params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/informes`);
  return (
    <PortalPage title="Informes" subtitle="Descarga el estado de tu sitio en PDF.">
      <section className="hud flex flex-col gap-3 rounded-lg p-4">
        <h2 className="text-[20px] leading-6 font-semibold text-ink">Informe del proyecto</h2>
        <p className="text-[15px] leading-5 text-ink-muted">Estado actual de cada página, puntos por mejorar y evolución del rendimiento.</p>
        <a href={`${base}/informe`} download className="press inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-[17px] font-semibold text-on-primary">
          Descargar informe (PDF)
        </a>
      </section>
    </PortalPage>
  );
}
