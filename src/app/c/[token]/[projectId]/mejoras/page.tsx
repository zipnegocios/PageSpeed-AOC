import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { pageTitle } from "@/lib/brand";
import { Badge } from "@/lib/ui/components/badge";
import { PortalPage } from "../../../_components/portal-page";
import { loadProjectGate } from "../../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Mejoras"), robots: { index: false, follow: false } };

export default async function PortalImprovements({ params }: { params: Promise<{ token: string; projectId: string }> }) {
  const { token, projectId } = await params;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, base } = gate;
  if (projectId !== project.slug) redirect(`${base}/mejoras`);
  return (
    <PortalPage title="Mejoras" subtitle="Lo que está por debajo de la meta acordada para tu sitio.">
      {project.improvements.length === 0 ? (
        <p className="rounded-lg bg-surface-200 p-4 text-ink">Todo está dentro de la meta. No hay nada pendiente por ahora.</p>
      ) : (
        <ul className="hud divide-y divide-border overflow-hidden rounded-lg">
          {project.improvements.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="danger">{a.kind === "audit_failure" ? "Sin datos" : "Bajo la meta"}</Badge>
                <span className="font-semibold text-ink">{a.kind === "audit_failure" ? "No pudimos auditar esta página" : a.summary}</span>
              </div>
              <p className="text-[15px] text-ink-muted">
                <span className="font-mono break-all">{a.routePath}</span> · {PROFILE_LABEL[a.profile]} · desde {formatDate(a.openedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PortalPage>
  );
}
