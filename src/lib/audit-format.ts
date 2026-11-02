import type { AuditLog } from "@/server/services/audits";

export const STATUS_LABEL: Record<AuditLog["status"], string> = {
  queued: "En cola",
  running: "En curso",
  succeeded: "Correcta",
  failed: "Falló",
};

export const PROFILE_LABEL: Record<AuditLog["profile"], string> = { mobile: "Móvil", desktop: "Escritorio" };

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export const formatDate = (d: Date | null | undefined) => (d ? `${dateFormat.format(d)} UTC` : "—");

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Métricas de tiempo de Lighthouse: segundos con un decimal. */
export function formatSeconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

export function isPending(status: AuditLog["status"]): boolean {
  return status === "queued" || status === "running";
}
