import Link from "next/link";
import { PROFILE_LABEL, formatAgo } from "@/lib/audit-format";
import type { PageFeedEntry, RecentAudit } from "@/server/services/dashboard";
import { AuditStatusBadge } from "@/app/admin/_components/audit-badge";
import { Score } from "./score";

const at = (a: RecentAudit) => (a.finishedAt ?? a.queuedAt).getTime();

/** Una ficha de dispositivo: puntuación de rendimiento (o el estado si no terminó bien), hora, y enlace a SU auditoría. */
function Chip({ profile, audit, now }: { profile: "mobile" | "desktop"; audit: RecentAudit | null; now?: Date }) {
  if (!audit) {
    return (
      <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-[15px] text-ink-muted" aria-label={`${PROFILE_LABEL[profile]}: sin auditoría`}>
        {PROFILE_LABEL[profile]} —
      </span>
    );
  }
  return (
    <Link
      href={`/admin/auditorias/${audit.id}`}
      className="press pointer-events-auto relative inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface-300 px-3 text-[15px] font-semibold text-ink hover:border-primary"
    >
      <span>{PROFILE_LABEL[profile]}</span>
      {audit.status === "succeeded" ? <Score value={audit.scorePerformance} className="text-[18px]" /> : <AuditStatusBadge audit={audit} />}
      <span className="font-medium text-ink-muted">{formatAgo(audit.finishedAt ?? audit.queuedAt, now)}</span>
    </Link>
  );
}

/**
 * Las páginas con actividad más reciente de todos los proyectos. Una fila por página, con sus dos dispositivos juntos: cada
 * ficha abre su propia auditoría y el resto de la fila abre la más reciente, así que se llega a cualquiera en un clic.
 */
export function AuditFeed({ pages, now }: { pages: PageFeedEntry[]; now?: Date }) {
  if (pages.length === 0) return <p className="text-ink-muted">Todavía no hay auditorías. Lanza la primera desde la ficha de un proyecto.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {pages.map((p) => {
        const newest = [p.mobile, p.desktop].filter((a): a is RecentAudit => a !== null).sort((a, b) => at(b) - at(a))[0]!;
        return (
          <li key={p.key} className="hud-flat press rise relative flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-3 py-2 hover:border-primary">
            <Link href={`/admin/auditorias/${newest.id}`} aria-label={`Abrir la auditoría más reciente de ${p.routePath} en ${p.projectName}`} className="absolute inset-0 rounded-md" />
            <span className="pointer-events-none relative flex min-w-0 flex-col">
              <span className="text-[17px] leading-5 font-semibold break-words text-ink">
                {p.projectName} <span className="font-medium text-ink-muted">· {p.clientName}</span>
              </span>
              <span className="font-mono text-[14px] leading-5 break-all text-ink-muted">{p.routePath}</span>
            </span>
            <span className="pointer-events-none relative flex flex-wrap items-center gap-2">
              <Chip profile="mobile" audit={p.mobile} now={now} />
              <Chip profile="desktop" audit={p.desktop} now={now} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
