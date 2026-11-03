import { StatusMark } from "@/lib/ui/components/status-mark";
import type { AuditView } from "@/server/domain/lhr-view";
import { DetailsBlock, type DetailsContext } from "./details-block";
import { InlineText } from "./inline-text";

function saving(a: AuditView): string {
  const parts: string[] = [];
  if (a.savingsMs && a.savingsMs > 0) parts.push(`ahorro estimado de ${a.savingsMs >= 1000 ? `${(a.savingsMs / 1000).toFixed(1)} s` : `${Math.round(a.savingsMs)} ms`}`);
  if (a.savingsBytes && a.savingsBytes > 0) parts.push(`ahorro estimado de ${(a.savingsBytes / 1024).toFixed(a.savingsBytes >= 10240 ? 0 : 1)} KiB`);
  return parts.join(" · ");
}

/** Una auditoría como un desplegable nativo: estado, título, valor o ahorro, y al abrir su descripción y detalle. */
export function AuditRow({ audit, open = false, ctx }: { audit: AuditView; open?: boolean; ctx?: DetailsContext }) {
  const note = [audit.displayValue, saving(audit)].filter(Boolean).join(" — ");
  return (
    <details open={open} className="group border-t border-border first:border-t-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 px-3 py-3 hover:bg-surface-300 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5"><StatusMark status={audit.status} /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <span className="font-semibold text-ink"><InlineText text={audit.title} /></span>
          {note ? <span className={`text-[15px] ${audit.status === "fail" ? "text-danger" : "text-ink-muted"} sm:text-right`}>{note}</span> : null}
        </span>
        <span aria-hidden className="mt-1 text-ink-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-4 pl-10">
        {audit.description ? <p className="text-[15px] leading-5 text-ink-muted"><InlineText text={audit.description} /></p> : null}
        <DetailsBlock details={audit.details} ctx={ctx} />
        {audit.tips.map((t, i) => (
          <p key={i} className="rounded-sm bg-primary-subtle px-3 py-2 text-[15px] leading-5 text-on-primary-subtle">
            <strong>{t.pack}:</strong> <InlineText text={t.text} />
          </p>
        ))}
      </div>
    </details>
  );
}

/** Grupo plegable (aprobadas, no aplicables, revisión manual): cerrado por defecto. */
export function CollapsedGroup({ title, audits, open, ctx }: { title: string; audits: AuditView[]; open: boolean; ctx?: DetailsContext }) {
  if (audits.length === 0) return null;
  return (
    <details className="rounded-sm border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[17px] font-semibold text-ink hover:bg-surface-300">
        {title} ({audits.length})
      </summary>
      <div className="border-t border-border">
        {audits.map((a) => (
          <AuditRow key={a.id} audit={a} open={open} ctx={ctx} />
        ))}
      </div>
    </details>
  );
}
