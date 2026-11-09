import type { ReactNode } from "react";
import { formatAgo, formatDate } from "@/lib/audit-format";
import {
  ctrDelta,
  formatCount,
  formatDayLong,
  formatDayMedium,
  formatPercent,
  formatPosition,
  percentDelta,
  positionDelta,
} from "@/lib/seo-format";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { KpiTile } from "@/lib/ui/components/kpi-tile";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { channelLabel, parseSeoPeriod, SEO_PERIODS, SEO_PERIOD_LABEL } from "@/server/domain/seo-data";
import { getSeoDashboard, type SeoDashboard, type SeoSyncInfo } from "@/server/services/seo-data";
import { requestSeoSyncAction } from "../actions";
import { DataTable } from "./data-table";
import { SeoChart } from "./seo-chart";

const ANCHOR = "trafico-y-busqueda";

const SYNC_BADGE = {
  ok: { tone: "ok", label: "Al día" },
  error: { tone: "danger", label: "Con error" },
  pending: { tone: "neutral", label: "Pendiente" },
} as const;

const share = (value: number, total: number) => (total > 0 ? formatPercent(value / total) : "—");

/** Una fuente de datos: hasta qué día hay datos, cuándo se actualizó y, si falló, por qué. */
function SourceStatus({ name, sync }: { name: string; sync: SeoSyncInfo }) {
  const badge = SYNC_BADGE[sync.status];
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-semibold text-ink">{name}</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className="text-[15px] leading-5 text-ink-muted">
        {sync.syncedThrough ? `Datos hasta el ${formatDayLong(sync.syncedThrough)}` : "Aún sin datos descargados"}
        {" · "}
        {sync.lastSyncAt ? (
          <span title={formatDate(sync.lastSyncAt)}>Última actualización {formatAgo(sync.lastSyncAt)}</span>
        ) : (
          "Sin actualizaciones todavía"
        )}
      </p>
      {sync.detail && sync.status !== "ok" ? (
        <p className={sync.status === "error" ? "text-[15px] leading-5 text-on-danger-subtle" : "text-[15px] leading-5 text-ink-muted"}>{sync.detail}</p>
      ) : null}
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[19px] leading-6 font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

const NO_BASE = "Sin datos del periodo anterior para comparar";

/**
 * Sección «Tráfico y búsqueda» de un proyecto: periodo, frescura de los datos, indicadores con su variación, gráficos
 * diarios y rankings de Search Console, GA4 y visitas desde asistentes de IA. El llamador debe haber comprobado que el
 * proyecto tiene alguna conexión (gsc o ga4).
 */
export async function SeoDataSection({ projectId, basePath, dias }: { projectId: string; basePath: string; dias: string | string[] | undefined }) {
  const days = parseSeoPeriod(dias);
  const d = await getSeoDashboard(projectId, { days });
  const { search, traffic, ai } = d;
  const hasGsc = d.sync.gsc !== null;
  const hasGa4 = d.sync.ga4 !== null;
  const noGsc = hasGsc ? "Sin datos de Search Console en este periodo. Pulsa «Actualizar ahora» para descargarlos." : "Conecta Search Console más abajo para ver estos datos.";
  const noGa4 = hasGa4 ? "Sin visitas de GA4 en este periodo. Pulsa «Actualizar ahora» para descargarlas." : "Conecta Google Analytics 4 más abajo para ver estos datos.";

  return (
    <div id={ANCHOR} className="scroll-mt-4">
      <Card title="Tráfico y búsqueda" description="Qué tanto aparece el sitio en Google y qué visitas recibe, con el cambio frente al periodo anterior.">
        <SegmentedNav label="Periodo" items={SEO_PERIODS.map((p) => ({ label: SEO_PERIOD_LABEL[p], href: `${basePath}?dias=${p}#${ANCHOR}`, current: p === days }))} />

        <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface-100 p-3 md:p-4">
          <ul className="grid gap-4 md:grid-cols-2">
            {d.sync.gsc ? <SourceStatus name="Search Console" sync={d.sync.gsc} /> : null}
            {d.sync.ga4 ? <SourceStatus name="Google Analytics 4" sync={d.sync.ga4} /> : null}
          </ul>
          <ActionForm action={requestSeoSyncAction.bind(null, projectId)} submitLabel="Actualizar ahora" pendingLabel="Pidiendo…" variant="secondary" className="max-w-xl" />
        </div>

        {d.range === null ? (
          <p className="rounded-sm border border-border bg-surface-100 px-4 py-6 text-center text-[15px] leading-5 text-ink-muted">
            Aún no hay datos: pulsa «Actualizar ahora» para descargarlos de Google. La primera descarga puede tardar unos minutos; después se actualizan solos cada día.
          </p>
        ) : (
          <Dashboard d={d} days={days} noGsc={noGsc} noGa4={noGa4} search={search} traffic={traffic} ai={ai} />
        )}
      </Card>
    </div>
  );
}

function Dashboard({
  d,
  days,
  noGsc,
  noGa4,
  search,
  traffic,
  ai,
}: {
  d: SeoDashboard;
  days: number;
  noGsc: string;
  noGa4: string;
  search: SeoDashboard["search"];
  traffic: SeoDashboard["traffic"];
  ai: SeoDashboard["ai"];
}) {
  const range = d.range!;
  const prev = d.previous!;
  const s = search;
  const t = traffic;
  const sp = s?.previousTotals;
  const clickTotal = s?.totals.clicks ?? 0;
  const sessionTotal = t?.totals.sessions ?? 0;

  return (
    <>
      <p className="text-[15px] leading-5 text-ink-muted">
        Del {formatDayMedium(range.from)} al {formatDayMedium(range.to)} ({days} días), comparado con el periodo anterior: del {formatDayMedium(prev.from)} al {formatDayMedium(prev.to)}.
      </p>

      <Group title="En Google (Search Console)">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
          <KpiTile label="Clics" value={s ? formatCount(s.totals.clicks) : null} delta={s && sp ? percentDelta(s.totals.clicks, sp.clicks) : null} hint={s && sp && sp.clicks === 0 ? NO_BASE : undefined} />
          <KpiTile label="Impresiones" value={s ? formatCount(s.totals.impressions) : null} delta={s && sp ? percentDelta(s.totals.impressions, sp.impressions) : null} hint={s && sp && sp.impressions === 0 ? NO_BASE : undefined} />
          <KpiTile label="CTR" value={s ? formatPercent(s.totals.ctr) : null} delta={s && sp && sp.impressions > 0 ? ctrDelta(s.totals.ctr, sp.ctr) : null} hint={s && sp && sp.impressions === 0 ? NO_BASE : undefined} />
          <KpiTile
            label="Posición media"
            value={s ? formatPosition(s.totals.position) : null}
            delta={s && sp ? positionDelta(s.totals.position, sp.position) : null}
            hint={s ? "Menos es mejor" : undefined}
          />
        </div>
        {!s ? <p className="text-[15px] leading-5 text-ink-muted">{noGsc}</p> : null}
      </Group>

      <Group title="En el sitio (GA4)">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
          <KpiTile label="Sesiones" value={t ? formatCount(t.totals.sessions) : null} delta={t ? percentDelta(t.totals.sessions, t.previousTotals.sessions) : null} hint={t && t.previousTotals.sessions === 0 ? NO_BASE : undefined} />
          <KpiTile label="Usuarios" value={t ? formatCount(t.totals.users) : null} delta={t ? percentDelta(t.totals.users, t.previousTotals.users) : null} hint={t && t.previousTotals.users === 0 ? NO_BASE : undefined} />
          <KpiTile label="Visitas desde IA" value={ai ? formatCount(ai.totals.sessions) : t ? "0" : null} delta={ai ? percentDelta(ai.totals.sessions, ai.previousTotals.sessions) : null} hint={ai && ai.previousTotals.sessions === 0 ? NO_BASE : "Desde asistentes como ChatGPT o Perplexity"} />
        </div>
        {!t ? <p className="text-[15px] leading-5 text-ink-muted">{noGa4}</p> : null}
      </Group>

      <div className="grid gap-6 xl:grid-cols-2">
        {s ? <SeoChart title="Clics por día" unit="clics" series={s.daily.map((p) => ({ date: p.date, value: p.clicks }))} tone={1} /> : null}
        {t ? <SeoChart title="Sesiones por día" unit="sesiones" series={t.daily.map((p) => ({ date: p.date, value: p.sessions }))} tone={2} /> : null}
      </div>

      <Group title="Búsqueda en Google">
        <DataTable
          title="Páginas con más clics"
          columns={[
            { header: "Página", mono: true, cell: (r) => r.page },
            { header: "Clics", numeric: true, cell: (r) => formatCount(r.clicks) },
            { header: "Impresiones", numeric: true, hideOnMobile: true, cell: (r) => formatCount(r.impressions) },
            { header: "CTR", numeric: true, hideOnMobile: true, cell: (r) => formatPercent(r.ctr) },
            { header: "Posición", numeric: true, cell: (r) => formatPosition(r.position) },
          ]}
          rows={s?.topPages ?? []}
          rowKey={(r) => r.page}
          empty={noGsc}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <DataTable
            title="Países"
            columns={[
              { header: "País", cell: (r) => r.name },
              { header: "Clics", numeric: true, cell: (r) => formatCount(r.clicks) },
              { header: "Impresiones", numeric: true, cell: (r) => formatCount(r.impressions) },
            ]}
            rows={s?.countries ?? []}
            rowKey={(r) => r.country}
            empty={noGsc}
          />
          <DataTable
            title="Dispositivos"
            columns={[
              { header: "Dispositivo", cell: (r) => r.label },
              { header: "Clics", numeric: true, cell: (r) => formatCount(r.clicks) },
              { header: "% de clics", numeric: true, cell: (r) => share(r.clicks, clickTotal) },
            ]}
            rows={s?.devices ?? []}
            rowKey={(r) => r.device}
            empty={noGsc}
          />
        </div>
      </Group>

      <Group title="Visitas al sitio">
        <DataTable
          title="Páginas más visitadas"
          columns={[
            { header: "Página", mono: true, cell: (r) => r.page },
            { header: "Sesiones", numeric: true, cell: (r) => formatCount(r.sessions) },
            { header: "Usuarios", numeric: true, cell: (r) => formatCount(r.users) },
          ]}
          rows={t?.topPages ?? []}
          rowKey={(r) => r.page}
          empty={noGa4}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <DataTable
            title="Canales de origen"
            columns={[
              { header: "Canal", cell: (r) => channelLabel(r.channel) },
              { header: "Sesiones", numeric: true, cell: (r) => formatCount(r.sessions) },
              { header: "% del total", numeric: true, cell: (r) => share(r.sessions, sessionTotal) },
            ]}
            rows={t?.channels ?? []}
            rowKey={(r) => r.channel}
            empty={noGa4}
          />
          <DataTable
            title="Países"
            columns={[
              { header: "País", cell: (r) => r.country },
              { header: "Sesiones", numeric: true, cell: (r) => formatCount(r.sessions) },
              { header: "% del total", numeric: true, cell: (r) => share(r.sessions, sessionTotal) },
            ]}
            rows={t?.countries ?? []}
            rowKey={(r) => r.country}
            empty={noGa4}
          />
        </div>
      </Group>

      <Group title="Visitas desde asistentes de IA">
        <div className="grid gap-6 lg:grid-cols-2">
          <DataTable
            title="Por fuente"
            columns={[
              { header: "Fuente", mono: true, cell: (r) => r.source },
              { header: "Sesiones", numeric: true, cell: (r) => formatCount(r.sessions) },
            ]}
            rows={ai?.bySource ?? []}
            rowKey={(r) => r.source}
            empty="Aún no hay visitas desde asistentes de IA en este periodo. Cuando ChatGPT, Perplexity o Gemini envíen visitas al sitio, aparecerán aquí."
          />
          <DataTable
            title="Páginas de entrada"
            columns={[
              { header: "Página", mono: true, cell: (r) => r.page },
              { header: "Sesiones", numeric: true, cell: (r) => formatCount(r.sessions) },
            ]}
            rows={ai?.topPages ?? []}
            rowKey={(r) => r.page}
            empty="Aún no hay visitas desde asistentes de IA en este periodo."
          />
        </div>
      </Group>
    </>
  );
}
