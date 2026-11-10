import type { Database } from "@/server/db/client";
import type { Period } from "@/server/domain/history";
import type { ReportKind } from "@/server/domain/report-outline";
import { buildProjectReport, reportFilename, type ReportData } from "@/server/services/report";
import { createSerialCache } from "./cache";
import { renderReportPdf } from "./pdf";

export type ReportFile = { filename: string; pdf: Buffer; data: ReportData };

// El de ingeniería puede pesar un par de MB: pocas entradas y poco tiempo, para no apretar el web de 512 MB.
const cache = createSerialCache<ReportFile>({ ttlMs: 2 * 60_000, maxEntries: 12 });

/** PDF del informe de un proyecto (resumen o ingeniería). El llamador comprueba antes que quien lo pide puede verlo. */
export function getProjectReportPdf(projectId: string, days: Period, kind: ReportKind = "summary", db?: Database): Promise<ReportFile> {
  return cache.get(`${projectId}:${days}:${kind}`, async () => {
    const data = await buildProjectReport(projectId, { days, kind }, db);
    return { filename: reportFilename(data), pdf: await renderReportPdf(data), data };
  });
}
