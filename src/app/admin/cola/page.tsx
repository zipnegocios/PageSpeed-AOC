import type { Metadata } from "next";
import Link from "next/link";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { verifySession } from "@/lib/auth/session";
import { projectPath } from "@/lib/urls";
import { Alert } from "@/lib/ui/components/alert";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { ActionForm } from "@/lib/ui/components/action-form";
import { getBackupStatus } from "@/server/services/backups";
import { getQueueStatus } from "@/server/services/queue-status";
import { AdminShell } from "../_components/admin-shell";
import { AutoRefresh } from "../_components/auto-refresh";
import { requestBackupAction } from "./actions";

export const metadata: Metadata = { title: "Cola · AOC PageSpeed", robots: { index: false, follow: false } };

const FREQUENCY = { weekly: "Semanal", daily: "Diaria" } as const;

export default async function QueuePage() {
  const session = await verifySession();
  const [status, backups] = await Promise.all([getQueueStatus(), getBackupStatus()]);
  const busy = (status.counts?.active ?? 0) + (status.counts?.waiting ?? 0) > 0;

  const stats = status.counts
    ? ([
        ["En curso", status.counts.active],
        ["En espera", status.counts.waiting],
        ["Reintento pendiente", status.counts.delayed],
        ["Falladas (30 días)", status.counts.failed],
        ["Completadas (7 días)", status.counts.completed],
      ] as const)
    : [];

  return (
    <AdminShell email={session.email} title="Cola de auditorías" crumbs={[{ label: "Panel", href: "/admin" }]}>
      <AutoRefresh active={busy} intervalMs={5000} />

      {!status.redis ? <Alert tone="danger">Redis no responde: solo se muestran los datos de la base de datos.</Alert> : null}

      <Card title="Estado" description="Las auditorías corren de una en una, con una pausa entre cada una.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={status.worker.online ? "ok" : "danger"}>{status.worker.online ? "Worker en línea" : "Worker fuera de línea"}</Badge>
          {status.worker.online && status.worker.chrome === false ? <Badge tone="danger">Sin Chromium</Badge> : null}
          {status.worker.lastBeatAt ? <span className="text-[15px] text-ink-muted">Último latido: {formatDate(status.worker.lastBeatAt)}</span> : null}
        </div>
        {status.counts ? (
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {stats.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 rounded-sm border border-border p-3">
                <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</dt>
                <dd className="text-[32px] leading-8 font-bold text-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>

      <Card title="Próximas auditorías programadas" description="Proyectos en producción. Cada uno tiene su propio momento fijo (UTC), repartido para no amontonar auditorías.">
        {status.schedules.length === 0 ? (
          <p className="text-ink-muted">No hay proyectos en producción. Cuando haya uno, su agenda aparecerá aquí.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {status.schedules.map((s) => (
              <li key={s.projectId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <span className="flex min-w-0 flex-col">
                  <Link href={projectPath(s.clientSlug, s.projectSlug)} className="text-[19px] font-semibold break-words text-link hover:underline">
                    {s.projectName}
                  </Link>
                  <span className="text-[15px] text-ink-muted">
                    {s.clientName} · {FREQUENCY[s.frequency]}
                  </span>
                </span>
                {s.next ? (
                  <span className="text-[15px] whitespace-nowrap text-ink tabular-nums">{formatDate(s.next)}</span>
                ) : (
                  <Badge tone="danger">Sin agendar</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Respaldos" description="Cada día (03:17 UTC) el worker copia la base de datos a R2, fuera de las carpetas de los clientes. Se conservan 30 días y siempre los 5 más recientes.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={backups.stale ? "danger" : "ok"}>{backups.stale ? "Sin respaldo reciente" : "Al día"}</Badge>
          <span className="text-[15px] text-ink-muted">
            {backups.last
              ? `Último correcto: ${formatDate(new Date(backups.last.at))} · ${(backups.last.bytes / 1024).toFixed(0)} KB · ${backups.last.rows} filas`
              : "Todavía no hay ningún respaldo correcto."}
          </span>
        </div>
        {backups.lastError ? (
          <Alert tone="danger">
            El último intento falló ({formatDate(new Date(backups.lastError.at))}): {backups.lastError.message}
          </Alert>
        ) : null}
        {backups.recent === null ? (
          <Alert tone="danger">No se pudo leer la lista de respaldos de R2.</Alert>
        ) : backups.recent.length > 0 ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {backups.recent.map((b) => (
              <li key={b.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-mono text-[14px] break-all text-ink">{b.key}</span>
                <span className="text-[14px] whitespace-nowrap text-ink-muted tabular-nums">
                  {formatDate(b.lastModified)} · {(b.size / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm action={requestBackupAction} submitLabel="Respaldar ahora" pendingLabel="Pidiendo…" variant="secondary" />
      </Card>

      <Card title="Últimos fallos" description="Las 10 auditorías más recientes que terminaron en error.">
        {status.recentFailures.length === 0 ? (
          <p className="text-ink-muted">No hay auditorías fallidas.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {status.recentFailures.map((f) => (
              <li key={f.id}>
                <Link href={`/admin/auditorias/${f.id}`} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 hover:bg-surface-300">
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
      </Card>
    </AdminShell>
  );
}
