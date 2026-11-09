import { panelHref, type PanelSearch } from "@/app/_components/panel-search";
import { DataTable } from "@/app/_components/seo/data-table";
import { formatAgo, formatDate } from "@/lib/audit-format";
import { countDelta, formatEvidence, RUN_STATUS_LABEL, SEVERITY_LABEL, SEVERITY_PLURAL } from "@/lib/seo-crawl-format";
import { formatCount } from "@/lib/seo-format";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { KpiTile } from "@/lib/ui/components/kpi-tile";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import type { Severity } from "@/server/domain/seo-crawl-rules";
import type { CrawlReport, CrawlRunView } from "@/server/services/seo-crawl";
import { requestCrawlAction } from "../actions";

const ANCHOR = "auditoria-tecnica";
const SEVERITY_TONE = { error: "danger", warning: "warning", info: "neutral" } as const;
const KPI_TONE = { error: "danger", warning: "warning", info: undefined } as const;

const TRIGGER_LABEL = { manual: "a pedido", scheduled: "semanal" } as const;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Estado del rastreo más reciente: qué pasó, cuándo y de qué tamaño fue. */
function RunLine({ run }: { run: CrawlRunView }) {
  const when = run.finishedAt ?? run.startedAt ?? run.queuedAt;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-5 text-ink-muted">
      <Badge tone={run.status === "failed" ? "danger" : run.status === "partial" ? "warning" : run.status === "succeeded" ? "ok" : "neutral"}>{RUN_STATUS_LABEL[run.status]}</Badge>
      <span title={formatDate(when)}>{capitalize(formatAgo(when))}</span>
      <span>·</span>
      <span>{formatCount(run.pagesCrawled)} {run.pagesCrawled === 1 ? "página" : "páginas"}</span>
      <span>·</span>
      <span>{TRIGGER_LABEL[run.trigger]}</span>
    </p>
  );
}

/**
 * Auditoría técnica del sitio de un proyecto: estado del último rastreo, hallazgos por gravedad con su variación frente
 * al rastreo anterior, agrupados por tipo, y el detalle de cada tipo con las páginas afectadas. Solo para administradores.
 */
export function CrawlSection({ projectId, report, basePath, search }: { projectId: string; report: CrawlReport; basePath: string; search: PanelSearch }) {
  const { active, latest, current, previous, counts, previousCounts, changes, groups, detail, markets, lang } = report;
  const href = (patch: Partial<Record<keyof PanelSearch, string | null>>) => panelHref(basePath, search, patch, ANCHOR);
  const languageItems = markets.length > 0 ? [{ lang: null as string | null, label: "Todos" }, ...markets.map((m) => ({ lang: m.lang as string | null, label: m.label })), ...(markets.some((m) => m.isDefault) ? [] : [{ lang: "none" as string | null, label: "Sin idioma" }])] : [];
  const failedAfter = latest && latest.status === "failed" && latest.id !== current?.id ? latest : null;

  return (
    <div id={ANCHOR} className="scroll-mt-4">
      <Card title="Auditoría técnica" description="Un rastreo del sitio como lo haría un buscador: encuentra problemas de indexación, idiomas, contenido y datos estructurados.">
        <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface-100 p-3 md:p-4">
          {active ? (
            <p className="text-[15px] leading-5 text-ink-muted">
              <Badge tone="neutral">{RUN_STATUS_LABEL[active.status]}</Badge>{" "}
              {active.status === "queued" ? "Hay un rastreo esperando su turno en el worker." : `Hay un rastreo en curso, iniciado ${formatAgo(active.startedAt ?? active.queuedAt)}.`} Recarga la página en unos minutos para ver el resultado.
            </p>
          ) : latest ? (
            <RunLine run={latest} />
          ) : (
            <p className="text-[15px] leading-5 text-ink-muted">Todavía no se ha rastreado este sitio. Pulsa «Rastrear ahora»: tarda unos minutos y, después, se repite cada semana en los proyectos en producción con Search Console o GA4 conectados.</p>
          )}
          {failedAfter && !active && current ? <p className="text-[15px] leading-5 text-ink-muted">Abajo se ven los resultados del último rastreo que terminó ({formatAgo(current.finishedAt ?? current.queuedAt)}).</p> : null}
          <ActionForm action={requestCrawlAction.bind(null, projectId)} submitLabel="Rastrear ahora" pendingLabel="Pidiendo…" variant="secondary" className="max-w-xl" />
        </div>

        {failedAfter && !active ? <Alert tone="danger">El último rastreo no pudo terminar. {failedAfter.detail ?? "No se pudo rastrear el sitio."}</Alert> : null}
        {current?.status === "partial" && current.detail ? <Alert tone="info">{current.detail} Las comprobaciones que necesitan ver todo el sitio (páginas huérfanas, idiomas sin páginas) no se evaluaron.</Alert> : null}

        {current && counts ? (
          <>
            {languageItems.length > 0 ? <SegmentedNav label="Idioma" items={languageItems.map((l) => ({ label: l.label, href: href({ idioma: l.lang, hallazgo: null }), current: l.lang === lang }))} /> : null}

            <div className="grid grid-cols-3 gap-x-4 gap-y-5">
              {(["error", "warning", "info"] as Severity[]).map((sev) => (
                <KpiTile key={sev} label={SEVERITY_PLURAL[sev]} value={formatCount(counts[sev])} tone={counts[sev] > 0 ? KPI_TONE[sev] : undefined} delta={sev === "info" ? null : countDelta(counts[sev], previousCounts ? previousCounts[sev] : null)} />
              ))}
            </div>
            <p className="text-[15px] leading-5 text-ink-muted">
              Rastreo del {formatDate(current.finishedAt ?? current.queuedAt)} · {formatCount(current.pagesCrawled)} {current.pagesCrawled === 1 ? "página" : "páginas"} revisadas.
              {changes && previous ? ` Frente al rastreo del ${formatDate(previous.finishedAt ?? previous.queuedAt)}: ${formatCount(changes.added)} ${changes.added === 1 ? "nuevo" : "nuevos"} y ${formatCount(changes.resolved)} ${changes.resolved === 1 ? "resuelto" : "resueltos"}.` : " Es el primer rastreo: aún no hay con qué comparar."}
            </p>

            {groups.length === 0 ? (
              <p className="rounded-sm border border-border bg-surface-100 px-4 py-6 text-center text-[15px] leading-5 text-ink-muted">
                {lang ? "No hay hallazgos en este idioma." : "El rastreo no encontró ningún problema. Buen trabajo."}
              </p>
            ) : (
              <DataTable
                title="Hallazgos por tipo"
                description="De más a menos grave. Abre uno para ver las páginas afectadas."
                columns={[
                  {
                    header: "Hallazgo",
                    cell: (g) => (
                      <div className="flex flex-col gap-1">
                        <a href={href({ hallazgo: g.code })} className="font-semibold text-ink underline underline-offset-2 hover:text-primary" aria-current={detail?.code === g.code ? "true" : undefined}>
                          {g.title}
                        </a>
                        <span className="text-[14px] leading-5 text-ink-muted">{g.advice}</span>
                      </div>
                    ),
                  },
                  { header: "Gravedad", cell: (g) => <Badge tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</Badge> },
                  { header: "Páginas", numeric: true, cell: (g) => formatCount(g.pages) },
                  { header: "Nuevos", numeric: true, hideOnMobile: true, cell: (g) => (g.added > 0 ? formatCount(g.added) : "—") },
                ]}
                rows={groups}
                rowKey={(g) => g.code}
                empty=""
              />
            )}

            {detail ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[19px] leading-6 font-semibold text-ink">{detail.title}</h3>
                    <Badge tone={SEVERITY_TONE[detail.severity]}>{SEVERITY_LABEL[detail.severity]}</Badge>
                  </div>
                  <a href={href({ hallazgo: null })} className="text-[15px] font-semibold text-link hover:underline">
                    Cerrar detalle
                  </a>
                </div>
                <p className="text-[15px] leading-5 text-ink-muted">{detail.advice}</p>
                <DataTable
                  title="Páginas afectadas"
                  columns={[
                    { header: "Página", mono: true, cell: (r) => (r.page === "" ? "Todo el sitio" : r.page) },
                    { header: "Qué se encontró", cell: (r) => formatEvidence(detail.code, r.evidence) || "—" },
                    { header: "Idioma", hideOnMobile: true, cell: (r) => r.lang ?? "—" },
                    { header: "", cell: (r) => (r.isNew ? <Badge tone="primary">Nuevo</Badge> : null) },
                  ]}
                  rows={detail.rows}
                  rowKey={(r) => r.page}
                  empty="Sin páginas."
                />
                {detail.more > 0 ? <p className="text-[15px] leading-5 text-ink-muted">Se muestran las primeras {formatCount(detail.rows.length)}; faltan {formatCount(detail.more)} más.</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}
