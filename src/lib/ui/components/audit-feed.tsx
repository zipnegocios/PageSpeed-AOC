import Link from "next/link";
import { PROFILE_LABEL, formatAgo } from "@/lib/audit-format";
import type { RecentAudit } from "@/server/services/dashboard";
import { AuditStatusBadge } from "@/app/admin/_components/audit-badge";
import { Score } from "./score";

/**
 * Las últimas auditorías de todos los proyectos. Cada fila entera es un enlace a la auditoría: un clic desde el panel.
 * Las que no terminaron bien muestran su estado en lugar de las puntuaciones.
 */
export function AuditFeed({ audits, now }: { audits: RecentAudit[]; now?: Date }) {
  if (audits.length === 0) return <p className="text-ink-muted">Todavía no hay auditorías. Lanza la primera desde la ficha de un proyecto.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {audits.map((a) => (
        <li key={a.id}>
          <Link
            href={`/admin/auditorias/${a.id}`}
            className="glass-flat press flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md px-3 py-2 hover:border-primary"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-[17px] leading-5 font-semibold break-words text-ink">
                {a.projectName} <span className="font-medium text-ink-muted">· {a.clientName}</span>
              </span>
              <span className="text-[14px] leading-5 text-ink-muted">
                <span className="font-mono break-all">{a.routePath}</span> · {PROFILE_LABEL[a.profile]} · {formatAgo(a.finishedAt ?? a.queuedAt, now)}
              </span>
            </span>
            {a.status === "succeeded" ? (
              <span className="flex items-center gap-3 text-[18px] tabular-nums" aria-label="Rendimiento, SEO, Accesibilidad y Buenas prácticas">
                <Score value={a.scorePerformance} />
                <Score value={a.scoreSeo} className="hidden sm:inline" />
                <Score value={a.scoreAccessibility} className="hidden sm:inline" />
                <Score value={a.scoreBestPractices} className="hidden sm:inline" />
              </span>
            ) : (
              <AuditStatusBadge audit={a} />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
