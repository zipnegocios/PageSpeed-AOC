import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FieldDataCard } from "@/app/_components/field-data-card";
import { HistoryPanel, type HistorySearch } from "@/app/_components/history-panel";
import { formatDate } from "@/lib/audit-format";
import { pageTitle } from "@/lib/brand";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { portalLogoUrl } from "@/lib/ui/components/client-logo";
import { ScoreRing } from "@/lib/ui/components/score-ring";
import { clientInitials } from "@/server/domain/client-logo";
import { averageScores } from "@/server/services/history";
import { getPortalMeasurements } from "@/server/services/project-measurements";
import { MeasurementCards } from "../../_components/measurement-cards";
import { ChevronRight } from "../../_components/portal-icons";
import { PortalPage } from "../../_components/portal-page";
import { loadProjectGate } from "../../_lib/project-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Resumen"), robots: { index: false, follow: false } };

const TILES = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;

export default async function PortalSummary({ params, searchParams }: { params: Promise<{ token: string; projectId: string }>; searchParams: Promise<HistorySearch> }) {
  const { token, projectId } = await params;
  const search = await searchParams;
  const gate = await loadProjectGate(token, projectId);
  if (gate.kind === "notice") return gate.element;
  const { project, client, base } = gate;
  // Un enlace antiguo con UUID se lleva a la dirección legible.
  if (projectId !== project.slug) redirect(base);

  const avg = averageScores(project.latest);
  const agentic = project.latest.reduce((acc, l) => (l.agentic ? { passed: acc.passed + l.agentic.passed, total: acc.total + l.agentic.total } : acc), { passed: 0, total: 0 });
  const lastAudit = project.latest.reduce<Date | null>((max, l) => (max === null || l.finishedAt > max ? l.finishedAt : max), null);
  const pages = new Set(project.latest.map((l) => l.routeId)).size;
  const open = project.improvements.length;
  const measurements = await getPortalMeasurements(client.id, project, { days: 28, hasLighthouse: project.latest.length > 0 });

  return (
    <PortalPage width="contained" title="Resumen" subtitle={<span className="font-mono break-all text-[14px]">{project.baseUrl}</span>}>
      {project.latest.length === 0 ? (
        <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Todavía no hay auditorías de este proyecto.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {client.logo ? (
            <li className="hud flex min-h-36 items-center justify-center overflow-hidden rounded-lg p-4" style={client.logo.bg ? { background: client.logo.bg } : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- logotipo privado ya reducido, servido por la ruta del portal. */}
              <img src={portalLogoUrl(token, client.logo.full ? "full" : "icon", client.logo.v)} alt={client.name} className="max-h-24 w-full object-contain" />
            </li>
          ) : (
            <li className="hud flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg p-3 text-center">
              <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-primary-subtle text-[20px] font-bold text-on-primary-subtle">
                {clientInitials(client.name)}
              </span>
              <span className="line-clamp-2 text-[15px] leading-5 font-semibold text-ink">{client.name}</span>
            </li>
          )}
          {TILES.map(([key, label]) => (
            <li key={key} className="hud flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg p-3 text-center">
              <ScoreRing value={avg[key]} label={label} size={72} />
              <span className="text-[13px] leading-4 font-semibold text-ink-muted">{label}</span>
            </li>
          ))}
          <li className="hud flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg p-3 text-center">
            <AgenticFraction value={agentic.total > 0 ? agentic : null} className="text-[28px] leading-8" />
            <span className="text-[13px] leading-4 font-semibold text-ink-muted">Navegación agéntica</span>
          </li>
        </ul>
      )}

      {/* En escritorio, dos columnas: las mediciones a la izquierda y los atajos a la derecha; en el teléfono, una sola columna. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <MeasurementCards m={measurements} base={base} />

      <section className="flex min-w-0 flex-col gap-3">
      <h2 className="hidden text-[20px] leading-7 font-bold tracking-[-0.01em] text-ink lg:block">Atajos</h2>
      <ul className="hud divide-y divide-border overflow-hidden rounded-lg">
        {[
          { href: `${base}/mejoras`, label: "Puntos por mejorar", value: open === 0 ? "Todo dentro de la meta" : `${open} ${open === 1 ? "pendiente" : "pendientes"}`, tone: open === 0 ? "text-ok" : "text-danger" },
          { href: `${base}/rutas`, label: "Páginas auditadas", value: String(pages), tone: "text-ink-muted" },
          { href: `${base}/informes`, label: "Última auditoría", value: lastAudit ? formatDate(lastAudit) : "—", tone: "text-ink-muted" },
        ].map((row) => (
          <li key={row.label}>
            <Link href={row.href} className="press flex min-h-14 items-center gap-3 px-4 py-2">
              <span className="flex-1 text-[17px] text-ink">{row.label}</span>
              <span className={`text-[17px] ${row.tone}`}>{row.value}</span>
              <ChevronRight className="text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
      </section>
      </div>

      {/* Evolución y datos reales, lado a lado en escritorio. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <details name="resumen" className="group flex flex-col gap-3" open={[search.ruta, search.perfil, search.m, search.dias].some((v) => v !== undefined)}>
        <summary className="press hud flex min-h-14 items-center gap-3 rounded-lg px-4 py-2">
          <span className="flex-1 text-[17px] font-semibold text-ink">Evolución de las puntuaciones</span>
          <ChevronRight className="chev shrink-0 text-ink-muted" />
        </summary>
        <div className="mt-3">
          <HistoryPanel projectId={project.id} basePath={base} search={search} description="Cómo han cambiado las puntuaciones de tus páginas con el tiempo." />
        </div>
      </details>
      <section id="experiencia-real" className="min-w-0 scroll-mt-20">
        <FieldDataCard projectId={project.id} basePath={base} search={search} audience="client" />
      </section>
      </div>
    </PortalPage>
  );
}
