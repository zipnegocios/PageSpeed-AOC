import { requireAuditAccess } from "@/lib/auth/access";
import type { Metadata } from "next";
import { PROFILE_LABEL, formatDate, formatDuration, formatSeconds, isPending } from "@/lib/audit-format";
import { clientPath, projectPath } from "@/lib/urls";
import { orNotFound } from "@/lib/not-found";
import { Alert } from "@/lib/ui/components/alert";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { Card } from "@/lib/ui/components/card";
import { getLocale } from "@/lib/locale";
import { ProfileSwitch } from "@/lib/ui/components/profile-switch";
import { Score } from "@/lib/ui/components/score";
import type { CategoryChecks } from "@/server/domain/failed-checks";
import { AuditViewer, type ViewerSearch } from "../../../_components/audit-viewer/viewer";
import { loadAuditLhr } from "@/server/services/audit-lhr";
import { getAudit, getSiblingAudits, insightsFromLhr } from "@/server/services/audits";
import { localizeLhr } from "@/server/report/lighthouse-report";
import { AdminShell } from "../../_components/admin-shell";
import { AuditStatusBadge } from "../../_components/audit-badge";
import { AutoRefresh } from "../../_components/auto-refresh";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Auditoría"), robots: { index: false, follow: false } };

function FailedChecksCard({ categories }: { categories: CategoryChecks[] | null }) {
  const total = categories?.reduce((n, c) => n + c.failedCount, 0) ?? 0;
  return (
    <Card
      title="Comprobaciones que fallan"
      description="Lo que resta puntos en cada categoría, de mayor a menor peso. Corregirlas sube la puntuación."
    >
      {categories === null ? (
        <p className="text-ink-muted">No se pudo leer el informe completo en el almacenamiento.</p>
      ) : total === 0 ? (
        <p className="text-ink-muted">Todas las comprobaciones con peso en la puntuación se cumplen.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {categories
            .filter((c) => c.failedCount > 0)
            .map((c) => (
              <section key={c.category} className="flex flex-col gap-2">
                <h3 className="flex items-baseline gap-2 text-[19px] font-semibold text-ink">
                  {c.label}
                  {c.score !== null ? <span className="text-[15px] text-ink-muted tabular-nums">{c.score}/100</span> : null}
                  <span className="text-[15px] font-normal text-ink-muted">
                    · {c.failedCount} {c.failedCount === 1 ? "comprobación" : "comprobaciones"}
                  </span>
                </h3>
                <ul className="divide-y divide-border rounded-sm border border-border">
                  {c.checks.map((k) => (
                    <li key={k.id} className="flex flex-col gap-1 px-3 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-ink">{k.title}</span>
                        {k.displayValue ? <span className="text-[15px] whitespace-nowrap text-ink-muted tabular-nums">{k.displayValue}</span> : null}
                      </div>
                      {k.description ? <p className="text-[15px] leading-5 text-ink-muted">{k.description}</p> : null}
                      {k.learnMoreUrl ? (
                        <a href={k.learnMoreUrl} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold text-link hover:underline">
                          Más información
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {c.failedCount > c.checks.length ? (
                  <p className="text-[15px] text-ink-muted">Se muestran las {c.checks.length} de mayor peso; el resto está en el informe completo.</p>
                ) : null}
              </section>
            ))}
        </div>
      )}
    </Card>
  );
}

const TRIGGER_LABEL = { manual: "Manual", scheduled: "Programada", mcp: "Agente (MCP)" } as const;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ViewerSearch> }) {
  const { id } = await params;
  const search = await searchParams;
  await orNotFound(requireAuditAccess(id));
  const audit = await orNotFound(getAudit(id));
  const siblings = await getSiblingAudits(id);
  // El selector de dispositivo conserva la pestaña del visor (Resumen, Rendimiento…).
  const qs = search.vista ? `?vista=${encodeURIComponent(search.vista)}` : "";
  const locale = await getLocale();
  const done = audit.status === "succeeded";
  const stored = done ? await loadAuditLhr(audit) : null;
  const lhr = stored ? localizeLhr(stored, locale) : null;
  const insights = lhr ? insightsFromLhr(lhr as never) : null;
  const opportunities = insights?.opportunities ?? null;

  const scores = [
    ["Rendimiento", audit.scorePerformance],
    ["SEO", audit.scoreSeo],
    ["Accesibilidad", audit.scoreAccessibility],
    ["Buenas prácticas", audit.scoreBestPractices],
  ] as const;
  const metrics = [
    ["LCP (contenido principal)", formatSeconds(audit.lcpMs)],
    ["FCP (primer contenido)", formatSeconds(audit.fcpMs)],
    ["TBT (bloqueo del hilo)", audit.tbtMs === null ? "—" : `${audit.tbtMs} ms`],
    ["CLS (desplazamiento)", audit.cls === null ? "—" : Number(audit.cls).toFixed(3)],
    ["TTFB (respuesta del servidor)", audit.ttfbMs === null ? "—" : `${audit.ttfbMs} ms`],
  ] as const;

  const scoresCard = (
    <Card title="Puntuaciones" description="Lighthouse, de 0 a 100. Navegación con agentes se cuenta en comprobaciones superadas.">
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {scores.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 rounded-sm border border-border p-3">
            <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
            <dd><Score value={value} className="text-[44px] leading-[44px]" /></dd>
          </div>
        ))}
        <div className="flex flex-col gap-1 rounded-sm border border-border p-3">
          <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Navegación con agentes</dt>
          <dd>
            <AgenticFraction value={audit.agenticPassed !== null && audit.agenticTotal !== null ? { passed: audit.agenticPassed, total: audit.agenticTotal } : null} className="text-[44px] leading-[44px]" hint />
          </dd>
        </div>
      </dl>
    </Card>
  );
  const labCard = (
    <Card title="Métricas de laboratorio">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="font-semibold text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[15px] leading-5 text-ink-muted">INP no se mide en el laboratorio de Lighthouse; el TBT es el indicador de interactividad equivalente.</p>
    </Card>
  );
  const improvementsCard = (
    <Card title="Mejoras principales" description="Ahorro estimado de tiempo de carga que propone Lighthouse.">
      {opportunities === null ? (
        <p className="text-ink-muted">No se pudo leer el informe completo en el almacenamiento.</p>
      ) : opportunities.length === 0 ? (
        <p className="text-ink-muted">Lighthouse no propone mejoras con ahorro de tiempo para esta página.</p>
      ) : (
        <ol className="divide-y divide-border rounded-sm border border-border">
          {opportunities.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <span className="text-ink">{o.title}</span>
              <span className="font-semibold whitespace-nowrap text-ink tabular-nums">−{formatSeconds(o.savingsMs)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={`/api/admin/audits/${audit.id}/report`} download className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300">
          Descargar informe completo (JSON)
        </a>
      </div>
    </Card>
  );
  const detailsCard = (
      <Card title="Detalles">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {(
            [
              ["Origen", `${TRIGGER_LABEL[audit.trigger]}${audit.requestedBy ? ` · ${audit.requestedBy}` : ""}`],
              ["Fase del proyecto al ejecutar", audit.phaseAtRun === "production" ? "Producción" : "Desarrollo"],
              ["En cola", formatDate(audit.queuedAt)],
              ["Terminó", formatDate(audit.finishedAt)],
              ["Duración", formatDuration(audit.durationMs)],
              ["Intentos", String(audit.attempts)],
              ["URL final", audit.finalUrl ?? "—"],
              ["Código HTTP", audit.httpStatus === null ? "—" : String(audit.httpStatus)],
              ["Versión de Lighthouse", audit.lighthouseVersion ?? "—"],
              ["Informe en R2", audit.r2Key ?? "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 border-b border-border pb-2">
              <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
              <dd className="text-[15px] break-all text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
  );

  return (
    <AdminShell
     
      title={audit.routePath}
      subtitle={`${PROFILE_LABEL[audit.profile]} · ${audit.projectName}`}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: "Clientes", href: "/admin/clientes" },
        { label: audit.clientName, href: clientPath(audit.clientSlug) },
        { label: audit.projectName, href: projectPath(audit.clientSlug, audit.projectSlug) },
      ]}
      actions={<AuditStatusBadge audit={audit} />}
    >
      <AutoRefresh active={isPending(audit.status)} />
      <ProfileSwitch current={audit.profile} currentScore={audit.scorePerformance} siblings={siblings} currentHref={`/admin/auditorias/${audit.id}${qs}`} hrefFor={(sid) => `/admin/auditorias/${sid}${qs}`} />

      {audit.status === "failed" ? (
        <Alert tone="danger">
          <strong>{audit.errorCode ?? "ERROR"}</strong>
          {audit.errorMessage ? ` · ${audit.errorMessage}` : ""} Intentos realizados: {audit.attempts}.
        </Alert>
      ) : null}
      {audit.status === "queued" && audit.errorCode ? (
        <Alert tone="info">
          El intento anterior falló ({audit.errorCode}) y se reintentará automáticamente. Intentos hasta ahora: {audit.attempts}.
        </Alert>
      ) : null}
      {isPending(audit.status) && !audit.errorCode ? <Alert tone="info">La auditoría está {audit.status === "running" ? "en curso" : "en cola"}. Esta página se actualiza sola.</Alert> : null}

      {done ? (
        lhr ? (
          <AuditViewer
            lhr={lhr}
            locale={locale}
            basePath={`/admin/auditorias/${audit.id}`}
            search={search}
            evidenceImageSrc={`/api/admin/audits/${audit.id}/captura`}
            reportSrc={`/api/admin/audits/${audit.id}/lighthouse`}
            summaryExtra={
              <>
                {labCard}
                <FailedChecksCard categories={insights?.failed ?? null} />
                {improvementsCard}
                {detailsCard}
              </>
            }
          />
        ) : (
          <>
            <Alert tone="danger">No se pudo leer el informe completo en el almacenamiento: se muestran los datos guardados en la base.</Alert>
            {scoresCard}
            {labCard}
            {improvementsCard}
            {detailsCard}
          </>
        )
      ) : (
        detailsCard
      )}
    </AdminShell>
  );
}
