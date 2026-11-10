import Link from "next/link";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { cx } from "@/lib/ui/cx";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import type { ProfileTab } from "@/lib/ui/components/profile-tabs";
import { Score } from "@/lib/ui/components/score";
import { type Profile } from "@/server/domain/route-tree";
import { formatVital, vitalTone, type VitalKind, type VitalTone } from "@/server/domain/vitals-band";
import type { PortalProfileView, PortalTreeNode } from "@/server/services/portal";
import { Hint } from "./hint";
import { ChevronRight } from "./portal-icons";
import { RouteProfileProvider, RouteProfileTabs, RouteStrip } from "./route-profile";

const STRIP = [
  ["performance", "R", "Rendimiento"],
  ["seo", "S", "SEO"],
  ["accessibility", "A", "Accesibilidad"],
  ["best_practices", "B", "Buenas prácticas"],
] as const;

const TONE: Record<VitalTone, string> = { ok: "text-ok", warning: "text-warning", danger: "text-danger" };

/** Leyenda de las cinco siglas: cada una es una pastilla que explica qué mide, con la misma burbuja que las celdas. */
export function RouteLegend() {
  return (
    <p className="flex flex-wrap gap-1.5 text-[13px] leading-5 text-ink-muted">
      {STRIP.map(([, letter, name]) => (
        <Hint key={letter} k={letter} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface-200 px-3 shadow-[0_0_0_1px_rgba(17,24,39,0.05)]">
          <b className="font-semibold text-ink">{letter}</b> {name}
        </Hint>
      ))}
      <Hint k="IA" className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface-200 px-3 shadow-[0_0_0_1px_rgba(17,24,39,0.05)]">
        <b className="font-semibold text-ink">IA</b> Navegación agéntica
      </Hint>
    </p>
  );
}

function Vital({ kind, label, value }: { kind: VitalKind; label: string; value: number | null }) {
  const tone = vitalTone(kind, value);
  return (
    <Hint k={kind === "lcp" ? "LCP" : kind === "cls" ? "CLS" : "TBT"} value={value} className="flex flex-col items-start rounded-md bg-surface-100 px-3 py-2 text-left">
      <span className="text-[12px] leading-4 font-semibold text-ink-muted">{label}</span>
      <span className={cx("text-[20px] leading-6 font-bold tabular-nums", tone ? TONE[tone] : "text-ink-muted")}>
        {formatVital(kind, value)}
        {tone ? <span className="sr-only"> ({tone === "ok" ? "bueno" : tone === "warning" ? "mejorable" : "deficiente"})</span> : null}
      </span>
    </Hint>
  );
}

/** La primera expansión de un perfil: métricas web esenciales, agentes, fecha y el botón al detalle de ingeniería. */
function ProfileDetail({ view, base }: { view: PortalProfileView; base: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Vital kind="lcp" label="LCP · carga principal" value={view.metrics.lcpMs} />
        <Vital kind="cls" label="CLS · estabilidad" value={view.metrics.cls} />
        <Vital kind="tbt" label="TBT · respuesta" value={view.metrics.tbtMs} />
        <Hint k="AG" value={view.agentic && view.agentic.total > 0 ? `${view.agentic.passed}/${view.agentic.total}` : null} className="flex flex-col items-start rounded-md bg-surface-100 px-3 py-2 text-left">
          <span className="text-[12px] leading-4 font-semibold text-ink-muted">Agentes</span>
          <AgenticFraction value={view.agentic} className="text-[20px] leading-6" />
        </Hint>
      </div>
      <p className="text-[13px] leading-5 text-ink-muted">Última auditoría: {formatDate(view.finishedAt)}</p>
      <Link
        href={`${base}/detalle/${view.auditId}`}
        className="press inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-[17px] font-semibold text-on-primary"
      >
        Ver detalle de ingeniería
      </Link>
    </div>
  );
}

function PageDetail({ node, base }: { node: PortalTreeNode; base: string }) {
  const profiles = (["mobile", "desktop"] as const).flatMap((p) => (node.page?.profiles[p] ? [[p, node.page.profiles[p]!] as const] : []));
  if (profiles.length === 0) return <p className="text-ink-muted">Todavía no hay auditorías de esta página.</p>;
  if (profiles.length === 1) return <ProfileDetail view={profiles[0]![1]} base={base} />;
  const tabs: ProfileTab[] = profiles.map(([profile, view]) => ({
    profile,
    label: PROFILE_LABEL[profile],
    badge: <Score value={view.scores.performance} className="text-[17px]" />,
    content: <ProfileDetail view={view} base={base} />,
  }));
  const first: Profile = node.page?.profiles.mobile ? "mobile" : "desktop";
  return <RouteProfileTabs label={`Dispositivo de ${node.title}`} defaultProfile={first} tabs={tabs} />;
}

/** Una fila del árbol: título, globito de mejoras y cinta de indicadores; se abre para ver sus métricas y las páginas que contiene. */
function RouteNode({ node, base, depth, group }: { node: PortalTreeNode; base: string; depth: number; group: string }) {
  const scores = node.page ? node.page.profiles : node.group;
  const first: Profile = scores.mobile ? "mobile" : "desktop";
  // Todo parte contraído y los hermanos de un mismo nivel forman un acordeón exclusivo (`name`): abrir uno cierra el otro. El globito rojo
  // ya dice cuántas mejoras hay dentro de cada fila.
  const virtual = node.page === null;
  return (
    <li className="min-w-0">
      <RouteProfileProvider initial={first}>
      <details name={group} className={cx("group min-w-0 rounded-lg", depth === 0 ? "hud" : "border border-border bg-surface-200")}>
        <summary className="press flex min-h-14 flex-col gap-2 rounded-lg px-3 py-2.5 focus-visible:outline-2">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[17px] leading-6 font-semibold break-words text-ink [overflow-wrap:anywhere] line-clamp-2">{node.title}</span>
            {virtual ? <span className="shrink-0 text-[12px] text-ink-muted">promedio del grupo</span> : null}
            {node.totalImprovements > 0 ? (
              <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[13px] leading-6 font-semibold text-white tabular-nums">
                {node.totalImprovements}
                <span className="sr-only"> {node.totalImprovements === 1 ? "mejora pendiente" : "mejoras pendientes"}</span>
              </span>
            ) : null}
            <ChevronRight className="chev shrink-0 text-ink-muted" />
          </span>
          <RouteStrip mobile={scores.mobile ?? null} desktop={scores.desktop ?? null} dashed={virtual} />
        </summary>
        <div className="flex min-w-0 flex-col gap-4 px-3 pb-4">
          {node.page ? (
            <section aria-label={`Esta página: ${node.title}`} className="flex flex-col gap-3">
              <h3 className="text-[13px] font-semibold tracking-[0.04em] text-ink-muted">
                Esta página · <span className="font-mono font-normal break-all">{node.path}</span>
              </h3>
              <PageDetail node={node} base={base} />
            </section>
          ) : null}
          {node.children.length > 0 ? (
            <section aria-label={`Páginas dentro de ${node.title}`} className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold tracking-[0.04em] text-ink-muted">Páginas dentro de «{node.title}»</h3>
              <ul className={cx("flex min-w-0 flex-col gap-2", depth < 2 && "border-l-2 border-border pl-2 min-[400px]:pl-2.5")}>
                {node.children.map((c) => (
                  <RouteNode key={c.path} node={c} base={base} depth={depth + 1} group={`rutas-${node.path}`} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </details>
      </RouteProfileProvider>
    </li>
  );
}

/** El árbol de páginas del proyecto. Cada fila se abre sola, sin JavaScript (elemento `<details>`). */
export function PortalRouteTree({ nodes, base }: { nodes: PortalTreeNode[]; base: string }) {
  return (
    // `grid-cols-1` es `minmax(0, 1fr)`: sin él la columna implícita es `auto` y un título largo la ensancha más que la pantalla.
    <ul className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
      {nodes.map((n) => (
        <RouteNode key={n.path} node={n} base={base} depth={0} group="rutas-raiz" />
      ))}
    </ul>
  );
}
