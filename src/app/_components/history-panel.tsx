import { Card } from "@/lib/ui/components/card";
import { Delta } from "@/lib/ui/components/delta";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { TrendChart } from "@/lib/ui/components/trend-chart";
import { PROFILE_LABEL } from "@/lib/audit-format";
import {
  HISTORY_METRICS, METRIC_META, PERIODS, PERIOD_LABEL, computeChange, formatMetric, parseMetric, parsePeriod,
} from "@/server/domain/history";
import { getSeries, listMonitoredRoutes } from "@/server/services/history";

export type HistorySearch = { ruta?: string; perfil?: string; m?: string; dias?: string };

const dayFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Evolución de una ruta: elige ruta, perfil, métrica y periodo mediante enlaces (sin scripts) y
 * dibuja la serie con su meta. Lo usan el panel de administración y el portal del cliente.
 * El llamador debe haber comprobado que el proyecto es accesible para quien mira.
 */
export async function HistoryPanel({
  projectId,
  basePath,
  search,
  allRoutes = false,
  description = "Cómo han cambiado las puntuaciones de cada página con el tiempo.",
}: {
  projectId: string;
  basePath: string;
  search: HistorySearch;
  /** El admin ve todas las rutas (también las de pruebas en desarrollo); el cliente, solo las monitoreadas. */
  allRoutes?: boolean;
  description?: string;
}) {
  const routes = await listMonitoredRoutes(projectId, { all: allRoutes });
  if (routes.length === 0) {
    return (
      <Card title="Evolución" description={description}>
        <p className="text-ink-muted">Aún no hay páginas monitoreadas.</p>
      </Card>
    );
  }

  const route = routes.find((r) => r.id === search.ruta) ?? routes[0]!;
  const profile = search.perfil === "desktop" ? "desktop" : "mobile";
  const metric = parseMetric(search.m);
  const days = parsePeriod(search.dias);
  const href = (patch: Partial<Record<keyof HistorySearch, string>>) => {
    const q = new URLSearchParams({ ruta: route.id, perfil: profile, m: metric, dias: String(days), ...patch });
    return `${basePath}?${q.toString()}#evolucion`;
  };

  const series = await getSeries({ projectId, routeId: route.id, profile, metric, days });
  const values = series.points.map((p) => p.value);
  const first = series.points[0];
  const last = series.points.at(-1);
  const change = first && last && series.points.length > 1 ? computeChange(metric, last.value, first.value) : null;
  const meta = METRIC_META[metric];
  const label = last
    ? `${meta.label}: ${series.points.length > 1 ? `de ${formatMetric(metric, first!.value)} a ${formatMetric(metric, last.value)} en ${PERIOD_LABEL[days]}, entre ${formatMetric(metric, Math.min(...values))} y ${formatMetric(metric, Math.max(...values))}` : `${formatMetric(metric, last.value)}, una sola auditoría en ${PERIOD_LABEL[days]}`}.`
    : `${meta.label}: sin auditorías en ${PERIOD_LABEL[days]}.`;

  return (
    <div id="evolucion" className="scroll-mt-4">
      <Card title="Evolución" description={description}>
        <div className="flex flex-col gap-3">
          {routes.length > 1 ? (
            <SegmentedNav
              label="Página"
              items={routes.map((r) => ({ label: r.path, href: href({ ruta: r.id }), current: r.id === route.id }))}
            />
          ) : null}
          <SegmentedNav
            label="Dispositivo"
            items={(["mobile", "desktop"] as const).map((p) => ({ label: PROFILE_LABEL[p], href: href({ perfil: p }), current: p === profile }))}
          />
          <SegmentedNav
            label="Métrica"
            items={HISTORY_METRICS.map((m) => ({ label: METRIC_META[m].short, href: href({ m }), current: m === metric }))}
          />
          <SegmentedNav
            label="Periodo"
            items={PERIODS.map((p) => ({ label: PERIOD_LABEL[p], href: href({ dias: String(p) }), current: p === days }))}
          />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{meta.label}</span>
          {last ? <span className="text-[32px] leading-8 font-bold text-ink tabular-nums">{formatMetric(metric, last.value)}</span> : null}
          <Delta change={change} />
          {change && first ? <span className="text-[14px] text-ink-muted">desde el {dayFormat.format(first.at)}</span> : null}
        </div>

        <TrendChart
          points={series.points.map((p) => ({ at: p.at, value: p.value }))}
          metric={metric}
          from={series.from}
          to={series.to}
          threshold={series.threshold}
          label={label}
        />

        {series.points.length > 0 ? (
          <p className="text-[15px] text-ink-muted">
            {series.points.length} {series.points.length === 1 ? "auditoría" : "auditorías"} en {PERIOD_LABEL[days]} · mínimo {formatMetric(metric, Math.min(...values))} · máximo {formatMetric(metric, Math.max(...values))}
            {series.threshold !== null ? ` · meta ${series.threshold}` : ""}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
