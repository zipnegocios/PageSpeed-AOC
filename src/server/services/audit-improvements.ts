import type { Database } from "@/server/db/client";
import { extractImprovements, isAuditImprovements, type AuditImprovements } from "@/server/domain/improvements";
import { listAuditImprovements, saveAuditImprovements } from "@/server/repositories/audits";
import { localizeLhr } from "@/server/report/lighthouse-report";
import type { R2Store } from "@/server/storage/r2";
import { loadAuditLhr } from "./audit-lhr";

/** Cuántas auditorías anteriores a la migración 0018 se leen de R2 en una sola petición (las demás salen en la siguiente). */
export const BACKFILL_PER_REQUEST = 12;

/**
 * Lo que hay que mejorar de varias auditorías. Sale de lo guardado al terminar cada una; una auditoría anterior a la
 * migración se lee de R2 una vez (con tope por petición) y queda guardada. Las que no se pueden leer faltan en el resultado.
 */
export async function loadAuditImprovements(auditIds: string[], db: Database, deps: { r2?: Pick<R2Store, "getAuditJson"> } = {}): Promise<Map<string, AuditImprovements>> {
  const rows = new Map((await listAuditImprovements(db, auditIds)).map((r) => [r.id, r]));
  const out = new Map<string, AuditImprovements>();
  let backfilled = 0;
  for (const id of auditIds) {
    const row = rows.get(id);
    if (row && isAuditImprovements(row.improvements)) {
      out.set(id, row.improvements);
    } else if (row && backfilled < BACKFILL_PER_REQUEST) {
      backfilled++;
      try {
        const lhr = await loadAuditLhr(row, deps.r2);
        if (!lhr) continue;
        const computed = extractImprovements(localizeLhr(lhr as never, "es"));
        out.set(id, computed);
        await saveAuditImprovements(db, id, computed);
      } catch {
        /* R2 sin configurar o un resultado ilegible: la página queda sin causas, no sin aviso ni sin informe */
      }
    }
  }
  return out;
}
