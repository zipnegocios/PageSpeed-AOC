import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FieldDataCard } from "@/app/_components/field-data-card";
import { HistoryPanel, type HistorySearch } from "@/app/_components/history-panel";
import { formatDate } from "@/lib/audit-format";
import { pageTitle } from "@/lib/brand";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { ScoreRing } from "@/lib/ui/components/score-ring";
import { averageScores } from "@/server/services/history";
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

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

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

  return (
    <PortalPage title="Resumen" subtitle={<span className="font-mono break-all text-[14px]">{project.baseUrl}</span>}>
      {project.latest.length === 0 ? (
        <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Todavía no hay auditorías de este proyecto.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <li className="hud flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg p-3 text-center">
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-primary-subtle text-[20px] font-bold text-on-primary-subtle">
              {initialsOf(client.name)}
            </span>
            <span className="line-clamp-2 text-[15px] leading-5 font-semibold text-ink">{client.name}</span>
          </li>
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

      <HistoryPanel projectId={project.id} basePath={base} search={search} description="Cómo han cambiado las puntuaciones de tus páginas con el tiempo." />
      <FieldDataCard projectId={project.id} basePath={base} search={search} audience="client" />
    </PortalPage>
  );
}
