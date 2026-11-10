import Link from "next/link";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { cx } from "@/lib/ui/cx";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { ProfileTabs, type ProfileTab } from "@/lib/ui/components/profile-tabs";
import { Score } from "@/lib/ui/components/score";
import { countPages, type Profile, type ProfileScores } from "@/server/domain/route-tree";
import { formatVital, vitalTone, type VitalKind, type VitalTone } from "@/server/domain/vitals-band";
import type { PortalProfileView, PortalTreeNode } from "@/server/services/portal";
import { ChevronRight } from "./portal-icons";

const STRIP = [
  ["performance", "R", "Rendimiento"],
  ["seo", "S", "SEO"],
  ["accessibility", "A", "Accesibilidad"],
  ["best_practices", "B", "Buenas prácticas"],
] as const;

/** Una rama se abre sola solo si contiene hasta tantas páginas. */
const AUTO_OPEN_MAX_PAGES = 12;

const TONE: Record<VitalTone, string> = { ok: "text-ok", warning: "text-warning", danger: "text-danger" };

/** Leyenda de las cinco letras de la cinta de indicadores. */
export function RouteLegend() {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-5 text-ink-muted">
      {STRIP.map(([, letter, name]) => (
        <span key={letter}>
          <b className="font-semibold text-ink">{letter}</b> {name}
        </span>
      ))}
      <span>
        <b className="font-semibold text-ink">IA</b> Navegación agéntica
      </span>
    </p>
  );
}

/** La cinta de cinco indicadores de una fila: R, S, A, B e IA, con su valor y su color por banda. */
function Strip({ data, dashed }: { data: ProfileScores | null; dashed?: boolean }) {
  return (
    <div className={cx("grid grid-cols-5 gap-1 min-[360px]:gap-1.5", dashed && "opacity-90")}>
      {STRIP.map(([key, letter, name]) => (
        <div key={key} className={cx("flex min-w-0 flex-col items-center overflow-hidden rounded-md bg-surface-100 py-1", dashed && "border border-dashed border-border-strong bg-transparent")}>
          <span aria-hidden className="text-[11px] leading-3 font-semibold text-ink-muted">
            {letter}
          </span>
          <span className="sr-only">{name}</span>
          <Score value={data?.scores[key] ?? null} className="text-[17px] leading-5" />
        </div>
      ))}
      <div className={cx("flex min-w-0 flex-col items-center overflow-hidden rounded-md bg-surface-100 py-1", dashed && "border border-dashed border-border-strong bg-transparent")}>
        <span aria-hidden className="text-[11px] leading-3 font-semibold text-ink-muted">
          IA
        </span>
        <span className="sr-only">Navegación agéntica</span>
        <AgenticFraction value={data?.agentic ?? null} className={cx("leading-5 tracking-tight whitespace-nowrap", (data?.agentic?.total ?? 0) > 99 ? "text-[11px]" : "text-[14px]")} />
      </div>
    </div>
  );
}

function Vital({ kind, label, value }: { kind: VitalKind; label: string; value: number | null }) {
  const tone = vitalTone(kind, value);
  return (
    <div className="flex flex-col rounded-md bg-surface-100 px-3 py-2">
      <dt className="text-[12px] leading-4 font-semibold text-ink-muted">{label}</dt>
      <dd className={cx("text-[20px] leading-6 font-bold tabular-nums", tone ? TONE[tone] : "text-ink-muted")}>
        {formatVital(kind, value)}
        {tone ? <span className="sr-only"> ({tone === "ok" ? "bueno" : tone === "warning" ? "mejorable" : "deficiente"})</span> : null}
      </dd>
    </div>
  );
}

/** La primera expansión de un perfil: métricas web esenciales, agentes, fecha y el botón al detalle de ingeniería. */
function ProfileDetail({ view, base }: { view: PortalProfileView; base: string }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Vital kind="lcp" label="LCP · carga principal" value={view.metrics.lcpMs} />
        <Vital kind="cls" label="CLS · estabilidad" value={view.metrics.cls} />
        <Vital kind="tbt" label="TBT · respuesta" value={view.metrics.tbtMs} />
        <div className="flex flex-col rounded-md bg-surface-100 px-3 py-2">
          <dt className="text-[12px] leading-4 font-semibold text-ink-muted">Agentes</dt>
          <dd>
            <AgenticFraction value={view.agentic} className="text-[20px] leading-6" />
          </dd>
        </div>
      </dl>
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
  return <ProfileTabs label={`Dispositivo de ${node.title}`} defaultProfile={first} tabs={tabs} />;
}

/** Una fila del árbol: título, globito de mejoras y cinta de indicadores; se abre para ver sus métricas y las páginas que contiene. */
function RouteNode({ node, base, depth }: { node: PortalTreeNode; base: string; depth: number }) {
  const strip: ProfileScores | null = node.page ? (node.page.profiles.mobile ?? node.page.profiles.desktop ?? null) : (node.group.mobile ?? node.group.desktop ?? null);
  // Se abren solas las ramas con mejoras dentro (el detalle de una página con mejoras propias queda plegado), salvo las
  // enormes (un catálogo de cientos de fichas): esas se abren a mano y el globito ya dice cuántas mejoras tienen dentro.
  const open = node.totalImprovements - node.ownImprovements > 0 && countPages(node.children) <= AUTO_OPEN_MAX_PAGES;
  const virtual = node.page === null;
  return (
    <li className="min-w-0">
      <details open={open} className={cx("group min-w-0 rounded-lg", depth === 0 ? "hud" : "border border-border bg-surface-200")}>
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
          <Strip data={strip} dashed={virtual} />
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
                  <RouteNode key={c.path} node={c} base={base} depth={depth + 1} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/** El árbol de páginas del proyecto. Cada fila se abre sola, sin JavaScript (elemento `<details>`). */
export function PortalRouteTree({ nodes, base }: { nodes: PortalTreeNode[]; base: string }) {
  return (
    // `grid-cols-1` es `minmax(0, 1fr)`: sin él la columna implícita es `auto` y un título largo la ensancha más que la pantalla.
    <ul className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
      {nodes.map((n) => (
        <RouteNode key={n.path} node={n} base={base} depth={0} />
      ))}
    </ul>
  );
}
