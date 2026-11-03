import Link from "next/link";
import { projectPath } from "@/lib/urls";
import { PROFILE_LABEL, formatDate } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import type { AlertView } from "@/server/services/alerts";

/** Lista de alertas abiertas. El rojo marca lo que requiere atención; el texto siempre acompaña. */
export function AlertList({ alerts, showProject = false }: { alerts: AlertView[]; showProject?: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-sm border border-border">
      {alerts.map((a) => (
        <li key={a.id} className="flex flex-col gap-1 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">{a.kind === "audit_failure" ? "Auditoría falla" : "Bajo el umbral"}</Badge>
            <span className="font-semibold text-ink">{a.summary}</span>
          </div>
          <p className="text-[15px] text-ink-muted">
            {showProject ? (
              <>
                <Link href={projectPath(a.clientSlug, a.projectSlug)} className="font-semibold text-link hover:underline">
                  {a.clientName} · {a.projectName}
                </Link>{" "}
                ·{" "}
              </>
            ) : null}
            <span className="font-mono break-all">{a.routePath}</span> · {PROFILE_LABEL[a.profile]} · abierta {formatDate(a.openedAt)}
            {a.lastNotifiedAt ? ` · último aviso ${formatDate(a.lastNotifiedAt)}` : " · aviso pendiente"}
            {a.reminderCount > 0 ? ` · ${a.reminderCount} ${a.reminderCount === 1 ? "recordatorio" : "recordatorios"}` : ""}
            {a.auditId ? (
              <>
                {" · "}
                <Link href={`/admin/auditorias/${a.auditId}`} className="font-semibold text-link hover:underline">
                  ver auditoría
                </Link>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

const TYPE_LABEL = { initial: "Alerta", reminder: "Recordatorio", failure: "Falla de auditoría", report: "Informe" } as const;

export function NotificationList({
  items,
  showProject = false,
}: {
  items: Array<{ id: string; type: keyof typeof TYPE_LABEL; status: "sent" | "failed"; subject: string; recipient: string; sentAt: Date; error: string | null; projectId: string; projectName: string; clientName: string }>;
  showProject?: boolean;
}) {
  return (
    <ul className="divide-y divide-border rounded-sm border border-border">
      {items.map((n) => (
        <li key={n.id} className="flex flex-col gap-1 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={n.status === "sent" ? "ok" : "danger"}>{n.status === "sent" ? "Enviado" : "No se envió"}</Badge>
            <Badge>{TYPE_LABEL[n.type]}</Badge>
            <span className="text-ink">{n.subject}</span>
          </div>
          <p className="text-[15px] text-ink-muted">
            {showProject ? `${n.clientName} · ${n.projectName} · ` : ""}
            Para {n.recipient} · {formatDate(n.sentAt)}
            {n.error ? ` · ${n.error}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
