import type { Database } from "@/server/db/client";
import { extractImprovements, isAuditImprovements, isLegacyImprovements, type AuditImprovements } from "@/server/domain/improvements";
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
    if (!row) continue;
    if (isAuditImprovements(row.improvements)) {
      out.set(id, row.improvements);
      continue;
    }
    // Sin resumen o con el de la versión anterior (solo 10 causas por rubro): se vuelve a calcular desde R2 una vez, con tope por petición.
    const legacy = isLegacyImprovements(row.improvements) ? row.improvements : null;
    if (backfilled < BACKFILL_PER_REQUEST) {
      backfilled++;
      try {
        const lhr = await loadAuditLhr(row, deps.r2);
        if (lhr) {
          const computed = extractImprovements(localizeLhr(lhr as never, "es"));
          out.set(id, computed);
          await saveAuditImprovements(db, id, computed);
          continue;
        }
      } catch {
        /* R2 sin configurar o un resultado ilegible: se queda con lo que ya había (si había), sin tumbar la página */
      }
    }
    if (legacy) out.set(id, legacy);
  }
  return out;
}
