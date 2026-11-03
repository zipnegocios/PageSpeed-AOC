import type { ReactNode } from "react";
import { formatDate } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { StatusMark } from "@/lib/ui/components/status-mark";
import { FIELD_LABEL, FIELD_METRICS, assess, formatField, rate, type FieldMetric, type Rating } from "@/server/domain/field-data";
import { findFieldData, getLastCruxRun } from "@/server/services/crux";
import { listMonitoredRoutes } from "@/server/services/history";
import { panelHref, type PanelSearch } from "./panel-search";

const WORD: Record<Rating, string> = { good: "bueno", "needs-improvement": "mejorable", poor: "deficiente" };
const MARK: Record<Rating, "pass" | "average" | "fail"> = { good: "pass", "needs-improvement": "average", poor: "fail" };
const pct = (n: number) => `${n.toFixed(n % 1 === 0 ? 0 : 1)} %`;

function Distribution({ good, needsImprovement, poor }: { good: number; needsImprovement: number; poor: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-surface-300" role="img" aria-label={`Bueno ${pct(good)}, mejorable ${pct(needsImprovement)}, deficiente ${pct(poor)}`}>
        <span className="bg-ok" style={{ width: `${good}%` }} />
        <span className="bg-warning" style={{ width: `${needsImprovement}%` }} />
        <span className="bg-danger" style={{ width: `${poor}%` }} />
      </div>
      <p className="text-[14px] text-ink-muted tabular-nums">
        Bueno {pct(good)} · Mejorable {pct(needsImprovement)} · Deficiente {pct(poor)}
      </p>
    </div>
  );
}

/**
 * Datos reales de usuarios (Chrome UX Report): la experiencia de visitantes reales de los últimos 28 días, que el
 * laboratorio de Lighthouse no puede medir (incluido el INP). Solo lectura; `footer` es para acciones del administrador.
 */
export async function FieldDataCard({
  projectId,
  basePath,
  search,
  audience,
  allRoutes = false,
  footer,
}: {
  projectId: string;
  basePath: string;
  search: PanelSearch;
  audience: "admin" | "client";
  allRoutes?: boolean;
  footer?: ReactNode;
}) {
  const routes = await listMonitoredRoutes(projectId, { all: allRoutes });
  const scope = search.campo === "pagina" && routes.length > 0 ? "pagina" : "origen";
  const route = routes.find((r) => r.id === search.cruta) ?? routes[0];
  const device = search.cdisp === "desktop" ? "desktop" : "mobile";
  const target = scope === "pagina" ? route?.id : "origin";
  const [row, lastRun] = await Promise.all([target ? findFieldData(projectId, target, device) : null, getLastCruxRun()]);
  const href = (patch: Partial<Record<"campo" | "cruta" | "cdisp", string>>) => panelHref(basePath, search, patch, "datos-reales");
  const verdict = assess(row?.status === "ok" ? row.metrics : null);

  return (
    <div id="datos-reales" className="scroll-mt-4">
      <Card title="Datos reales de usuarios" description="Chrome UX Report: lo que vivieron visitantes reales de Chrome en los últimos 28 días.">
        <div className="flex flex-col gap-3">
          <SegmentedNav
            label="Alcance"
            items={[
              { label: "Todo el sitio", href: href({ campo: "origen" }), current: scope === "origen" },
              ...(routes.length > 0 ? [{ label: "Una página", href: href({ campo: "pagina" }), current: scope === "pagina" }] : []),
            ]}
          />
          {scope === "pagina" && routes.length > 1 ? (
            <SegmentedNav label="Página" items={routes.map((r) => ({ label: r.path, href: href({ campo: "pagina", cruta: r.id }), current: r.id === route?.id }))} />
          ) : null}
          <SegmentedNav
            label="Dispositivo de los visitantes"
            items={[
              { label: "Móvil", href: href({ cdisp: "mobile" }), current: device === "mobile" },
              { label: "Escritorio", href: href({ cdisp: "desktop" }), current: device === "desktop" },
            ]}
          />
        </div>

        {row?.status === "ok" && row.metrics ? (
          <>
            <div>
              <Badge tone={verdict === "passed" ? "ok" : verdict === "failed" ? "danger" : "neutral"}>
                {verdict === "passed" ? "Evaluación de Core Web Vitals: aprobada" : verdict === "failed" ? "Evaluación de Core Web Vitals: no aprobada" : "Evaluación de Core Web Vitals: sin datos suficientes"}
              </Badge>
            </div>
            <ul className="divide-y divide-border rounded-sm border border-border">
              {FIELD_METRICS.flatMap((m: FieldMetric) => {
                const d = row.metrics?.[m];
                if (!d) return [];
                const rating = rate(m, d.p75);
                return [
                  <li key={m} className="flex flex-col gap-2 px-3 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-semibold text-ink">{FIELD_LABEL[m]}</span>
                      <span className="flex items-center gap-2 text-[24px] leading-7 font-bold text-ink tabular-nums">
                        {rating ? <StatusMark status={MARK[rating]} className="size-5" /> : null}
                        {formatField(m, d.p75)}
                        {rating ? <span className="text-[15px] font-semibold text-ink-muted">{WORD[rating]}</span> : null}
                      </span>
                    </div>
                    <Distribution good={d.good} needsImprovement={d.needsImprovement} poor={d.poor} />
                  </li>,
                ];
              })}
            </ul>
            <p className="text-[14px] text-ink-muted">
              {row.first && row.last ? `Datos del ${row.first} al ${row.last}. ` : ""}Actualizados {formatDate(row.fetchedAt)}. El valor mostrado es el percentil 75: tres de cada cuatro visitas lo igualan o lo mejoran.
            </p>
          </>
        ) : row?.status === "no_data" ? (
          <p className="text-ink-muted">
            {scope === "origen" ? "Este sitio" : "Esta página"} no tiene suficiente tráfico en Chrome en este dispositivo para mostrar datos reales. Actualizado {formatDate(row.fetchedAt)}.
          </p>
        ) : (
          <p className="text-ink-muted">
            {audience === "admin" && lastRun?.error === "NO_KEY"
              ? "Falta definir CRUX_API_KEY en el worker. Con la clave, los datos se piden cada día (ver el runbook)."
              : audience === "admin" && lastRun && !lastRun.ok
                ? `La última actualización falló (${lastRun.error ?? "error"}). Revisa la clave y vuelve a intentarlo.`
                : "Aún no hay datos reales para este proyecto. Se actualizan cada día."}
          </p>
        )}
        {footer}
      </Card>
    </div>
  );
}
