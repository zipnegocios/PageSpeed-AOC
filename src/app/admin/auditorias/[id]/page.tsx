import type { Metadata } from "next";
import { PROFILE_LABEL, formatDate, formatDuration, formatSeconds, isPending } from "@/lib/audit-format";
import { verifySession } from "@/lib/auth/session";
import { orNotFound } from "@/lib/not-found";
import { Alert } from "@/lib/ui/components/alert";
import { Card } from "@/lib/ui/components/card";
import { Score } from "@/lib/ui/components/score";
import { getAudit, getAuditOpportunities } from "@/server/services/audits";
import { AdminShell } from "../../_components/admin-shell";
import { AuditStatusBadge } from "../../_components/audit-badge";
import { AutoRefresh } from "../../_components/auto-refresh";

export const metadata: Metadata = { title: "Auditoría · AOC PageSpeed", robots: { index: false, follow: false } };

const TRIGGER_LABEL = { manual: "Manual", scheduled: "Programada", mcp: "Agente (MCP)" } as const;

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  const { id } = await params;
  const audit = await orNotFound(getAudit(id));
  const opportunities = await getAuditOpportunities(audit);
  const done = audit.status === "succeeded";

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

  return (
    <AdminShell
      email={session.email}
      title={audit.routePath}
      subtitle={`${PROFILE_LABEL[audit.profile]} · ${audit.projectName}`}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: "Clientes", href: "/admin/clientes" },
        { label: audit.clientName, href: `/admin/clientes/${audit.clientId}` },
        { label: audit.projectName, href: `/admin/proyectos/${audit.projectId}` },
      ]}
      actions={<AuditStatusBadge audit={audit} />}
    >
      <AutoRefresh active={isPending(audit.status)} />

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
        <>
          <Card title="Puntuaciones" description="Lighthouse, de 0 a 100.">
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {scores.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1 rounded-sm border border-border p-3">
                  <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
                  <dd><Score value={value} className="text-[44px] leading-[44px]" /></dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Métricas de laboratorio">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {metrics.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="font-semibold text-ink tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[15px] leading-5 text-ink-muted">
              INP no se mide en el laboratorio de Lighthouse; el TBT es el indicador de interactividad equivalente.
            </p>
          </Card>

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
            <div>
              <a
                href={`/api/admin/audits/${audit.id}/report`}
                download
                className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300"
              >
                Descargar informe completo (JSON)
              </a>
            </div>
          </Card>
        </>
      ) : null}

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
    </AdminShell>
  );
}
