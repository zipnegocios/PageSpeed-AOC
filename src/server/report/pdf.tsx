import { renderToBuffer } from "@react-pdf/renderer";
import type { ReportData } from "@/server/services/report";
import { registerFonts } from "./pdf-common";
import { EngineeringDocument } from "./pdf-engineering";
import { SummaryDocument } from "./pdf-summary";

/** Renderiza el informe a PDF (A4 vertical): el resumen o el de ingeniería, según `data.kind`. Sin I/O de red; las fuentes salen del repositorio. */
export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(data.kind === "engineering" ? <EngineeringDocument data={data} /> : <SummaryDocument data={data} />);
}
