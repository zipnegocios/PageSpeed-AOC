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

/** "hace 5 min", "hace 3 h", "hace 2 d"; para fechas futuras o de hace menos de un minuto, "ahora". */
export function formatAgo(date: Date | null | undefined, now: Date = new Date()): string {
  if (!date) return "—";
  const min = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d < 60 ? `hace ${d} d` : formatDate(date);
}
