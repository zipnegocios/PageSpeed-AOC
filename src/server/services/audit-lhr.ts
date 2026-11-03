import { redactLhr } from "@/server/domain/lhr-redact";
import { renderOfficialReport, type UiLocale } from "@/server/report/lighthouse-report";
import { getR2, type R2Store } from "@/server/storage/r2";

export type StoredLhr = Record<string, unknown>;

/** Resultado completo de Lighthouse de una auditoría correcta, tal como se guardó. null si no hay o R2 no responde. */
export async function loadAuditLhr(
  audit: { status: string; r2Key: string | null },
  r2: Pick<R2Store, "getAuditJson"> = getR2(),
): Promise<StoredLhr | null> {
  if (audit.status !== "succeeded" || !audit.r2Key) return null;
  try {
    return await r2.getAuditJson<StoredLhr>(audit.r2Key);
  } catch {
    return null;
  }
}

/** HTML del informe oficial de Lighthouse; `redact` quita capturas y fragmentos (rutas con sesión vistas por el cliente). */
export async function getOfficialReportHtml(
  audit: { status: string; r2Key: string | null },
  locale: UiLocale,
  options: { redact?: boolean; r2?: Pick<R2Store, "getAuditJson"> } = {},
): Promise<string | null> {
  const lhr = await loadAuditLhr(audit, options.r2);
  if (!lhr) return null;
  return renderOfficialReport(options.redact ? redactLhr(lhr) : lhr, locale);
}
