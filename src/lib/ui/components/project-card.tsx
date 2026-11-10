import Link from "next/link";
import { PROFILE_LABEL, formatAgo } from "@/lib/audit-format";
import { formatCount } from "@/lib/seo-format";
import { projectPath } from "@/lib/urls";
import type { FleetProject } from "@/server/services/dashboard";
import { AgenticFraction } from "./agentic-fraction";
import { Badge } from "./badge";
import { ClientLogo, adminLogoUrl } from "./client-logo";
import { Delta } from "./delta";
import { ScoreRing } from "./score-ring";
import { Sparkline } from "./sparkline";

/**
 * Un proyecto de un vistazo; toda la tarjeta es un enlace a su pantalla y "Última auditoría" va directo a esa auditoría.
 * Sin auditorías muestra anillos vacíos y "Sin auditorías".
 */
export function ProjectCard({ project: p, now }: { project: FleetProject; now?: Date }) {
  const href = projectPath(p.clientSlug, p.slug);
  return (
    <article className="hud-flat press rise relative flex min-w-0 flex-col gap-4 rounded-lg p-4 focus-within:border-primary hover:border-primary">
      <Link href={href} aria-label={`Abrir el proyecto ${p.name} de ${p.clientName}`} className="absolute inset-0 rounded-lg" />
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ClientLogo src={p.clientLogo ? adminLogoUrl(p.clientId, p.clientLogo.icon ? "icon" : "full", p.clientLogo.v) : null} name={p.clientName} bg={p.clientLogo?.bg} className="size-11 text-[26px]" />
            <div className="flex min-w-0 flex-col">
              <h4 className="text-[20px] leading-6 font-semibold break-words text-ink">{p.name}</h4>
              <span className="text-[15px] leading-5 break-all text-ink-muted">
                {p.clientName} · {p.baseUrl.replace(/^https?:\/\//, "")}
              </span>
            </div>
          </div>
          <Badge tone={p.phase === "production" ? "primary" : "neutral"}>{p.phase === "production" ? "Producción" : "Desarrollo"}</Badge>
        </header>

        <div className="flex items-center gap-4">
          <ScoreRing value={p.scores.performance} label="Rendimiento" size={104} />
          <dl className="grid flex-1 grid-cols-3 gap-2">
            {(
              [
                ["SEO", p.scores.seo],
                ["Accesib.", p.scores.accessibility],
                ["Prácticas", p.scores.best_practices],
              ] as const
            ).map(([name, value]) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <dd className="order-1">
                  <ScoreRing value={value} label={name} size={52} />
                </dd>
                <dt className="order-2 text-[12px] leading-4 font-semibold tracking-[0.06em] text-ink-muted uppercase">{name}</dt>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">Agentes</span>
            <AgenticFraction value={p.agentic} className="text-[20px] leading-6" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <Sparkline values={p.sparkline} label="Rendimiento, últimos 30 días" width={110} height={34} />
            <Delta change={p.performanceChange} />
          </div>
        </div>

        {p.traffic ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[15px] leading-5 text-ink-muted">
            <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] uppercase">Visitas 28 d</span>
            <b className="font-semibold text-ink tabular-nums">{formatCount(p.traffic.sessions)}</b>
            {p.traffic.deltaPct !== null ? (
              <span className={p.traffic.deltaPct >= 0 ? "font-semibold text-ok" : "font-semibold text-danger"}>
                <span aria-hidden>{p.traffic.deltaPct >= 0 ? "▲" : "▼"}</span> {Math.abs(Math.round(p.traffic.deltaPct))} %<span className="sr-only">{p.traffic.deltaPct >= 0 ? " (suben)" : " (bajan)"}</span>
              </span>
            ) : null}
            {p.traffic.topSource ? <span>· principal: {p.traffic.topSource}</span> : null}
          </p>
        ) : null}

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
          {p.lastByProfile.mobile || p.lastByProfile.desktop ? (
            (["mobile", "desktop"] as const).map((profile) => {
              const last = p.lastByProfile[profile];
              return last ? (
                <Link
                  key={profile}
                  href={`/admin/auditorias/${last.id}`}
                  className="pointer-events-auto relative inline-flex min-h-11 items-center text-[15px] font-semibold text-link hover:underline"
                >
                  {PROFILE_LABEL[profile]} · {formatAgo(last.finishedAt, now)}
                </Link>
              ) : null;
            })
          ) : (
            <span className="inline-flex min-h-11 items-center text-[15px] text-ink-muted">Sin auditorías</span>
          )}
          {p.openAlerts > 0 ? <Badge tone="danger">{p.openAlerts === 1 ? "1 alerta" : `${p.openAlerts} alertas`}</Badge> : null}
          {p.pending > 0 ? <Badge tone="primary">{p.pending === 1 ? "1 en curso" : `${p.pending} en curso`}</Badge> : null}
        </footer>
      </div>
    </article>
  );
}
