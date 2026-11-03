import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryPanel, type HistorySearch } from "@/app/_components/history-panel";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { Delta } from "@/lib/ui/components/delta";
import { Score } from "@/lib/ui/components/score";
import { getPortalOverview, getPortalProject } from "@/server/services/portal";
import { BlockedNotice } from "../../_components/blocked-notice";
import { PortalShell } from "../../_components/portal-shell";
import { SuspendedNotice } from "../../_components/suspended-notice";
import { portalAccess } from "../../_lib/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu informe · AOC PageSpeed", robots: { index: false, follow: false } };

const SCORES = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;

export default async function PortalProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; projectId: string }>;
  searchParams: Promise<HistorySearch>;
}) {
  const { token, projectId } = await params;
  const search = await searchParams;
  const access = await portalAccess(token);
  if (access.state === "blocked") return <BlockedNotice />;
  if (access.state === "suspended") return <SuspendedNotice clientName={access.clientName} />;

  const project = await getPortalProject(access.client.id, projectId);
  if (!project) notFound();
  const several = (await getPortalOverview(access.client.id)).length > 1;

  return (
    <PortalShell
      clientName={access.client.name}
      title={project.name}
      subtitle={
        <>
          <span className="font-mono break-all text-[15px]">{project.baseUrl}</span>
          {several ? (
            <>
              {" · "}
              <Link href={`/c/${token}`} className="font-semibold text-link hover:underline">
                Todos tus proyectos
              </Link>
            </>
          ) : null}
        </>
      }
    >
      <Card
        title="Estado actual"
        description="Resultado de la última auditoría de cada página, frente a la anterior."
        actions={
          <a
            href={`/c/${token}/${project.id}/informe`}
            download
            className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300"
          >
            Descargar informe (PDF)
          </a>
        }
      >
        {project.latest.length === 0 ? (
          <p className="text-ink-muted">Todavía no hay auditorías de este proyecto.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {project.latest.map((l) => (
              <li key={`${l.routeId}-${l.profile}`} className="flex flex-col gap-3 rounded-sm border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-mono text-[16px] font-semibold break-all text-ink">{l.path}</span>
                  <span className="text-[15px] text-ink-muted">
                    {PROFILE_LABEL[l.profile]} · {formatDate(l.finishedAt)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {SCORES.map(([key, label]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
                      <dd className="flex flex-wrap items-baseline gap-x-2">
                        <Score value={l.scores[key]} className="text-[32px] leading-8" />
                        <Delta change={l.changes[key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {project.improvements.length > 0 ? (
        <Card title="Puntos por mejorar" description="Lo que está por debajo de la meta acordada para tu sitio.">
          <ul className="divide-y divide-border rounded-sm border border-border">
            {project.improvements.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="danger">{a.kind === "audit_failure" ? "Sin datos" : "Bajo la meta"}</Badge>
                  <span className="font-semibold text-ink">
                    {a.kind === "audit_failure" ? "No pudimos auditar esta página" : a.summary}
                  </span>
                </div>
                <p className="text-[15px] text-ink-muted">
                  <span className="font-mono break-all">{a.routePath}</span> · {PROFILE_LABEL[a.profile]} · desde {formatDate(a.openedAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <HistoryPanel
        projectId={project.id}
        basePath={`/c/${token}/${project.id}`}
        search={search}
        description="Cómo han cambiado las puntuaciones de tus páginas con el tiempo."
      />
    </PortalShell>
  );
}
