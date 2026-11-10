import Link from "next/link";
import { cx } from "@/lib/ui/cx";
import { REPORT_SECTIONS, REPORT_TITLE, reportKindParam, type ReportKind } from "@/server/domain/report-outline";
import { DownloadButton } from "./download-button";
import { ChevronRight, TabIcons } from "./portal-icons";

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriodChoice = (typeof REPORT_PERIODS)[number];
const PERIOD_LABEL: Record<ReportPeriodChoice, string> = { 7: "7 días", 30: "30 días", 90: "90 días" };
export const parseReportPeriod = (raw: string | string[] | undefined): ReportPeriodChoice => {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportPeriodChoice) : 30;
};

const COPY: Record<ReportKind, { pages: string; description: string; button: string }> = {
  summary: {
    pages: "PDF · normalmente 2 a 4 páginas",
    description: "El estado de tu sitio en pocas páginas y en lenguaje claro: cómo va cada página, qué hay que mejorar, cómo ha evolucionado y, si lo tienes activado, tu tráfico y la salud SEO.",
    button: "Descargar resumen",
  },
  engineering: {
    pages: "PDF · desde unas 10 páginas, según el tamaño del sitio",
    description:
      "El detalle de ingeniería de cada página. Nuestros servidores abren tu sitio en un navegador real y lo miden con Lighthouse, la herramienta de Google; cada cifra se lee de esa medición guardada, no se estima ni se inventa. Aquí encuentras lo que mide, qué falla y cuánto afecta.",
    button: "Descargar informe de ingeniería",
  },
};

/** Una tarjeta de informe: descripción, «Qué contiene» (el índice del PDF, de `report-outline`) y su botón de descarga. */
function ReportCard({ kind, base, days }: { kind: ReportKind; base: string; days: ReportPeriodChoice }) {
  const copy = COPY[kind];
  const sections = REPORT_SECTIONS[kind];
  return (
    <section aria-label={REPORT_TITLE[kind]} className="hud flex min-w-0 flex-col gap-3 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-on-primary-subtle">{TabIcons.informes}</span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[20px] leading-6 font-semibold text-ink">{REPORT_TITLE[kind]}</h2>
          <span className="text-[13px] leading-5 text-ink-muted">{copy.pages}</span>
        </div>
      </div>
      <p className="text-[15px] leading-6 text-ink">{copy.description}</p>
      <details className="rounded-lg bg-surface-100">
        <summary className="press flex min-h-12 items-center gap-2 rounded-lg px-3 text-[16px] font-semibold text-ink">
          <span className="flex-1">Qué {kind === "engineering" ? "vas a encontrar" : "contiene"}</span>
          <span className="text-[13px] font-normal text-ink-muted">{sections.length} apartados</span>
          <ChevronRight className="chev text-ink-muted" />
        </summary>
        <ol className="flex flex-col gap-1 px-3 pb-3">
          {sections.map((s, i) => (
            <li key={s.id}>
              <details className="rounded-md bg-surface-200">
                <summary className="press flex min-h-11 items-center gap-2 rounded-md px-3 text-[15px] font-semibold text-ink">
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-300 text-[13px] text-ink-muted tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1">{s.title}</span>
                  <ChevronRight className="chev text-ink-muted" />
                </summary>
                <ul className="px-3 pb-3 pl-11 text-[14px] leading-5 text-ink-muted">
                  {s.bullets.map((b) => (
                    <li key={b} className="list-disc">
                      {b}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      </details>
      <DownloadButton href={`${base}/informe?tipo=${reportKindParam(kind)}&dias=${days}`} label={copy.button} />
    </section>
  );
}

/** Selector de periodo del informe (enlaces: la elección vive en la dirección). */
export function ReportPeriodSwitch({ base, days }: { base: string; days: ReportPeriodChoice }) {
  return (
    <nav aria-label="Periodo de los informes" className="flex rounded-[10px] bg-surface-300 p-0.5">
      {REPORT_PERIODS.map((p) => (
        <Link
          key={p}
          href={`${base}/informes?dias=${p}`}
          scroll={false}
          aria-current={p === days ? "page" : undefined}
          className={cx("press flex min-h-9 flex-1 items-center justify-center rounded-[8px] px-2 text-[14px] font-semibold", p === days ? "bg-surface-200 text-ink shadow-[0_1px_3px_rgba(17,24,39,0.18)]" : "text-ink-muted")}
        >
          {PERIOD_LABEL[p]}
        </Link>
      ))}
    </nav>
  );
}

export function ReportCards({ base, days }: { base: string; days: ReportPeriodChoice }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <ReportCard kind="summary" base={base} days={days} />
      <ReportCard kind="engineering" base={base} days={days} />
    </div>
  );
}
