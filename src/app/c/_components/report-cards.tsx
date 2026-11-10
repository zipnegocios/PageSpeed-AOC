import Link from "next/link";
import { cx } from "@/lib/ui/cx";
import type { MeasurementId, MeasurementState } from "@/server/domain/measurements";
import { REPORT_SECTIONS, REPORT_TITLE, reportKindParam, sectionState, type ReportKind } from "@/server/domain/report-outline";
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
    description: "Todo lo que medimos de tu sitio, en pocas páginas y en lenguaje claro: la velocidad de cada página, qué hay que mejorar, la experiencia de tus visitantes, de dónde llegan (buscadores, redes sociales, otros sitios), cómo te buscan en Google y la salud SEO.",
    button: "Descargar resumen",
  },
  engineering: {
    pages: "PDF · desde unas 10 páginas, según el tamaño del sitio",
    description:
      "El detalle de ingeniería de cada página. Nuestros servidores abren tu sitio en un navegador real y lo miden con Lighthouse, la herramienta de Google; cada cifra se lee de esa medición guardada, no se estima ni se inventa. Incluye también la experiencia real de tus visitantes, el reparto completo de tus visitas por origen y el detalle de Search Console.",
    button: "Descargar informe de ingeniería",
  },
};

/** Una tarjeta de informe: descripción, «Qué contiene» (el índice del PDF, de `report-outline`) y su botón de descarga. */
type States = Record<MeasurementId, MeasurementState>;
const STATE_MARK: Record<MeasurementState, { text: string; tone: string }> = {
  included: { text: "Incluido", tone: "bg-primary-subtle text-on-primary-subtle" },
  pending: { text: "Aún sin datos", tone: "bg-surface-300 text-ink-muted" },
  off: { text: "No activado", tone: "bg-surface-300 text-ink-muted" },
};

function ReportCard({ kind, base, days, states }: { kind: ReportKind; base: string; days: ReportPeriodChoice; states: States }) {
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
                  <span className="min-w-0 flex-1">{s.title}</span>
                  {sectionState(s, states) ? (
                    <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[12px] leading-4 font-semibold", STATE_MARK[sectionState(s, states)!].tone)}>{STATE_MARK[sectionState(s, states)!].text}</span>
                  ) : null}
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

export function ReportCards({ base, days, states }: { base: string; days: ReportPeriodChoice; states: States }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <ReportCard kind="summary" base={base} days={days} states={states} />
      <ReportCard kind="engineering" base={base} days={days} states={states} />
    </div>
  );
}
