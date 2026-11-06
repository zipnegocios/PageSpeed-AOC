import Link from "next/link";
import { formatDate, PROFILE_LABEL } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import { AuditFeed } from "@/lib/ui/components/audit-feed";
import { KpiTile } from "@/lib/ui/components/kpi-tile";
import { Panel } from "@/lib/ui/components/panel";
import { ProjectCard } from "@/lib/ui/components/project-card";
import { ScoreRing } from "@/lib/ui/components/score-ring";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { listOpenAlerts } from "@/server/services/alerts";
import { getFleet, listRecentPagesGlobal, sortFleet, summarizeFleet } from "@/server/services/dashboard";
import { getQueueStatus } from "@/server/services/queue-status";
import { HealthPanel } from "../health-panel";
import { AlertList } from "./alert-list";

export type PhaseFilter = "todos" | "produccion" | "desarrollo";

/** Cifras de toda la flota + una tarjeta por proyecto. Comparten datos, así que se piden una sola vez. */
export async function FleetSection({ phase }: { phase: PhaseFilter }) {
  const all = await getFleet().catch(() => null);
  if (all === null) {
    return (
      <Panel title="Flota" span={4}>
        <p className="text-ink-muted">No se pudieron leer los proyectos. Recarga la página en unos segundos.</p>
      </Panel>
    );
  }
  const now = new Date();
  const sum = summarizeFleet(all);
  const shown = sortFleet(all).filter((p) => phase === "todos" || (phase === "produccion" ? p.phase === "production" : p.phase === "development"));

  if (all.length === 0) {
    return (
      <Panel title="Todavía no hay proyectos" description="Crea un cliente y su primer proyecto para empezar a medir." span={4}>
        <div>
          <Link href="/admin/clientes" className="press inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-[17px] font-semibold text-on-primary hover:bg-primary-hover">
            Ir a clientes
          </Link>
        </div>
      </Panel>
    );
  }

  const href = (p: PhaseFilter) => (p === "todos" ? "/admin" : `/admin?fase=${p}`);
  return (
    <>
      <Panel id="resumen" title="Resumen de la flota" description="Promedio de las últimas auditorías de todos tus proyectos." span={4}>
        <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5">
            <ScoreRing value={sum.performance} label="Rendimiento medio" size={168} />
            <div className="flex flex-col gap-1">
              <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">Rendimiento medio</span>
              <span className="text-[15px] leading-5 text-ink-muted">{sum.projects - sum.withoutAudits} de {sum.projects} proyectos con datos</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(
                [
                  ["SEO", "SEO medio", sum.seo],
                  ["Accesibilidad", "Accesibilidad media", sum.accessibility],
                  ["Buenas prácticas", "Buenas prácticas medias", sum.bestPractices],
                ] as const
              ).map(([name, label, value]) => (
                <div key={name} className="flex items-center gap-3">
                  <ScoreRing value={value} label={label} size={72} />
                  <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">{name}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-6 border-t border-border pt-4 lg:grid-cols-4">
              <KpiTile label="Proyectos" value={sum.projects} hint={`${sum.production} en producción · ${sum.development} en desarrollo`} />
              <KpiTile label="Alertas abiertas" value={sum.openAlerts} tone={sum.openAlerts > 0 ? "danger" : undefined} hint={sum.openAlerts > 0 ? "Requieren atención" : "Todo dentro de la meta"} />
              <KpiTile label="Auditorías en curso" value={sum.pending} hint={sum.pending > 0 ? "En cola o corriendo" : "Nada pendiente"} />
              <KpiTile label="Sin auditar" value={sum.withoutAudits} hint="Proyectos sin ninguna auditoría" />
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        id="flota"
        title="Proyectos"
        description="Lo que necesita atención va primero. Toca un proyecto para abrirlo."
        span={4}
        actions={
          <SegmentedNav
            label="Filtrar por fase"
            items={(
              [
                ["todos", "Todos"],
                ["produccion", "Producción"],
                ["desarrollo", "Desarrollo"],
              ] as const
            ).map(([id, label]) => ({ label, href: href(id), current: phase === id }))}
          />
        }
      >
        {shown.length === 0 ? (
          <p className="text-ink-muted">No hay proyectos en esta fase.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => (
              <ProjectCard key={p.id} project={p} now={now} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export async function RecentAuditsPanel() {
  const pages = await listRecentPagesGlobal(10).catch(() => null);
  return (
    <Panel id="auditorias" title="Auditorías recientes" description="Por página, con móvil y escritorio juntos. Un clic abre la auditoría." span={2}>
      {pages === null ? <p className="text-ink-muted">No se pudieron leer las auditorías.</p> : <AuditFeed pages={pages} now={new Date()} />}
    </Panel>
  );
}

export async function AlertsPanel() {
  const alerts = await listOpenAlerts().catch(() => null);
  return (
    <Panel
      id="alertas"
      title="Alertas abiertas"
      description="Proyectos en producción por debajo de sus umbrales o con auditorías que fallan."
      span={2}
      actions={
        <Link href="/admin/alertas" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-link hover:underline">
          Ver todas
        </Link>
      }
    >
      {alerts === null ? (
        <p className="text-ink-muted">No se pudieron leer las alertas.</p>
      ) : alerts.length === 0 ? (
        <Badge tone="ok">Sin alertas abiertas</Badge>
      ) : (
        <AlertList alerts={alerts.slice(0, 5)} showProject />
      )}
      {alerts && alerts.length > 5 ? <p className="text-[15px] text-ink-muted">y {alerts.length - 5} más en la pantalla de alertas.</p> : null}
    </Panel>
  );
}

/** Estado del worker y la cola + últimos fallos, con una sola lectura de la cola. */
export async function OpsSection() {
  const status = await getQueueStatus().catch(() => null);
  const stats = status?.counts
    ? ([
        ["En curso", status.counts.active],
        ["En espera", status.counts.waiting],
        ["Reintentos", status.counts.delayed],
        ["Falladas", status.counts.failed],
      ] as const)
    : [];
  return (
    <>
      <Panel
        id="sistema"
        title="Cola y sistema"
        description="Las auditorías corren de una en una."
        span={2}
        actions={
          <Link href="/admin/cola" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-link hover:underline">
            Abrir la cola
          </Link>
        }
      >
        {status ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={status.worker.online ? "ok" : "danger"}>{status.worker.online ? "Worker en línea" : "Worker fuera de línea"}</Badge>
            {!status.redis ? <Badge tone="danger">Redis no responde</Badge> : null}
            {status.worker.lastBeatAt ? <span className="text-[15px] text-ink-muted">Último latido: {formatDate(status.worker.lastBeatAt)}</span> : null}
          </div>
        ) : (
          <Badge tone="danger">No se pudo leer el estado</Badge>
        )}
        {stats.length > 0 ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <KpiTile key={label} label={label} value={value} />
            ))}
          </dl>
        ) : null}
        <HealthPanel />
      </Panel>

      <Panel id="fallos" title="Últimos fallos" description="Auditorías que terminaron en error." span={2}>
        {!status || status.recentFailures.length === 0 ? (
          <p className="text-ink-muted">No hay auditorías fallidas.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {status.recentFailures.slice(0, 5).map((f) => (
              <li key={f.id}>
                <Link href={`/admin/auditorias/${f.id}`} className="glass-flat press flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 hover:border-primary">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono text-[15px] break-all text-ink">{f.routePath}</span>
                    <span className="text-[14px] text-ink-muted">
                      {f.projectName} · {PROFILE_LABEL[f.profile]} · {formatDate(f.finishedAt)}
                    </span>
                  </span>
                  <Badge tone="danger">{f.errorCode ?? "ERROR"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
