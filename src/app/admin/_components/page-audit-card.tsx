import Link from "next/link";
import { PROFILE_LABEL, formatAgo, formatDate, formatSeconds } from "@/lib/audit-format";
import { requestAuditAction } from "@/app/admin/proyectos/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { Badge } from "@/lib/ui/components/badge";
import { Delta } from "@/lib/ui/components/delta";
import { ProfileTabs, type ProfileTab } from "@/lib/ui/components/profile-tabs";
import { Score } from "@/lib/ui/components/score";
import { ScoreRing } from "@/lib/ui/components/score-ring";
import { defaultProfile, type PageAudits, type ProfileBlock } from "@/server/services/pages";
import { AuditStatusBadge } from "./audit-badge";

const RINGS = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;

/** Lo que se ve dentro de la pestaña de un dispositivo. */
function DevicePanel({ block, page, projectId, now }: { block: ProfileBlock; page: PageAudits; projectId: string; now: Date }) {
  const { latest, recent, profile } = block;
  const full = latest ? recent.find((a) => a.id === latest.auditId) : undefined;
  const device = PROFILE_LABEL[profile].toLowerCase();
  return (
    <div className="flex flex-col gap-5">
      {latest ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="text-[15px] text-ink-muted">
              Última auditoría correcta: {formatDate(latest.finishedAt)} · {formatAgo(latest.finishedAt, now)}
            </span>
            <Link href={`/admin/auditorias/${latest.auditId}`} className="inline-flex min-h-11 items-center text-[17px] font-semibold text-link hover:underline">
              Abrir auditoría
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {RINGS.map(([key, label]) => (
              <div key={key} className="flex flex-col items-start gap-1">
                <dd className="order-1">
                  <ScoreRing value={latest.scores[key]} label={label} size={72} />
                </dd>
                <dt className="order-2 text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
                <dd className="order-3">
                  <Delta change={latest.changes[key]} />
                </dd>
              </div>
            ))}
            <div className="flex flex-col items-start gap-1">
              <dd className="order-1 flex min-h-[72px] items-center">
                <AgenticFraction value={latest.agentic} className="text-[28px] leading-8" />
              </dd>
              <dt className="order-2 text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">Agentes</dt>
            </div>
          </dl>
          {full ? (
            <p className="text-[15px] text-ink-muted">
              LCP {formatSeconds(full.lcpMs)} · TBT {full.tbtMs === null ? "—" : `${full.tbtMs} ms`} · CLS {full.cls ?? "—"}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-ink-muted">
          {recent.length === 0 ? `Sin auditoría de ${device} todavía.` : `Aún no hay una auditoría correcta de ${device}.`}
        </p>
      )}

      {recent.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">Últimas auditorías de este dispositivo</span>
          <ul className="flex flex-col gap-2">
            {recent.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/auditorias/${a.id}`} className="hud-flat press flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 hover:border-primary">
                  <span className="text-[15px] text-ink">
                    {formatDate(a.finishedAt ?? a.queuedAt)} <span className="text-ink-muted">· {formatAgo(a.finishedAt ?? a.queuedAt, now)}</span>
                  </span>
                  {a.status === "succeeded" ? <Score value={a.scorePerformance} className="text-[20px]" /> : <AuditStatusBadge audit={a} />}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <ActionForm
          action={requestAuditAction.bind(null, projectId, page.route.id)}
          submitLabel="Auditar este dispositivo"
          pendingLabel="Encolando…"
          variant="secondary"
          className="flex-row flex-wrap items-center gap-2"
        >
          <input type="hidden" name="profile" value={profile} />
        </ActionForm>
        <ActionForm
          action={requestAuditAction.bind(null, projectId, page.route.id)}
          submitLabel="Auditar móvil y escritorio"
          pendingLabel="Encolando…"
          variant="secondary"
          className="flex-row flex-wrap items-center gap-2"
        >
          <input type="hidden" name="profile" value="both" />
        </ActionForm>
      </div>
    </div>
  );
}

/** La etiqueta de una pestaña: puntuación de rendimiento y, si hace falta, el estado de la auditoría más reciente. */
function tabBadge(block: ProfileBlock) {
  return (
    <>
      {block.latest?.scores.performance !== null && block.latest ? <Score value={block.latest.scores.performance} className="text-[17px]" /> : null}
      {block.state === "pending" ? <Badge tone="primary">En curso</Badge> : null}
      {block.state === "failed" ? <Badge tone="danger">Falló</Badge> : null}
    </>
  );
}

/** Una página del proyecto: su ruta y, en pestañas, cómo va en móvil y en escritorio. */
export function PageAuditCard({ page, projectId, now }: { page: PageAudits; projectId: string; now: Date }) {
  const tabs: ProfileTab[] = (["mobile", "desktop"] as const).map((profile) => {
    const block = page[profile];
    return { profile, label: PROFILE_LABEL[profile], badge: tabBadge(block), content: <DevicePanel block={block} page={page} projectId={projectId} now={now} /> };
  });
  return (
    <section aria-label={`Página ${page.route.path}`} className="hud rise flex min-w-0 flex-col gap-4 rounded-lg p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-mono text-[19px] leading-6 font-semibold break-all text-ink">{page.route.path}</h3>
        {page.route.label ? <span className="text-[15px] text-ink-muted">{page.route.label}</span> : null}
        {page.route.requiresAuth ? <Badge tone="neutral">Requiere sesión</Badge> : null}
        {!page.route.monitored ? <Badge tone="neutral">No monitoreada</Badge> : null}
      </header>
      <ProfileTabs label={`Dispositivo de ${page.route.path}`} defaultProfile={defaultProfile(page)} tabs={tabs} />
    </section>
  );
}
