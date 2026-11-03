import type { Database } from "@/server/db/client";
import { buildProjectReport, reportFilename, type ReportData } from "@/server/services/report";
import type { Period } from "@/server/domain/history";
import { createSerialCache } from "./cache";
import { renderReportPdf } from "./pdf";

export type ReportFile = { filename: string; pdf: Buffer; data: ReportData };

const cache = createSerialCache<ReportFile>({ ttlMs: 2 * 60_000 });

/** PDF del informe de un proyecto. El llamador comprueba antes que quien lo pide puede verlo. */
export function getProjectReportPdf(projectId: string, days: Period, db?: Database): Promise<ReportFile> {
  return cache.get(`${projectId}:${days}`, async () => {
    const data = await buildProjectReport(projectId, { days }, db);
    return { filename: reportFilename(data), pdf: await renderReportPdf(data), data };
  });
}
