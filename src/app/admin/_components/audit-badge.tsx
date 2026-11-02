import { STATUS_LABEL } from "@/lib/audit-format";
import { Badge } from "@/lib/ui/components/badge";
import type { AuditLog } from "@/server/services/audits";

const TONE = { queued: "neutral", running: "primary", succeeded: "ok", failed: "danger" } as const;

/** Estado de una auditoría. Si falló, el código del error va en el texto. */
export function AuditStatusBadge({ audit }: { audit: Pick<AuditLog, "status" | "errorCode"> }) {
  const label = audit.status === "failed" && audit.errorCode ? `${STATUS_LABEL.failed} · ${audit.errorCode}` : STATUS_LABEL[audit.status];
  return <Badge tone={TONE[audit.status]}>{label}</Badge>;
}
