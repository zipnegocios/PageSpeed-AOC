import Link from "next/link";
import type { ReactNode } from "react";
import { formatCount, formatPercent, formatPosition, percentDelta } from "@/lib/seo-format";
import { cx } from "@/lib/ui/cx";
import { Delta } from "@/lib/ui/components/delta";
import type { Assessment, Rating } from "@/server/domain/field-data";
import { MEASUREMENT_BY_ID, type MeasurementId } from "@/server/domain/measurements";
import type { PortalMeasurements } from "@/server/services/project-measurements";
import { ChevronRight } from "./portal-icons";

const share = (value: number, total: number) => (total > 0 ? formatPercent(value / total) : "—");

const RATING_TONE: Record<Rating, string> = { good: "text-ok", "needs-improvement": "text-warning", poor: "text-danger" };
const RATING_WORD: Record<Rating, string> = { good: "bueno", "needs-improvement": "mejorable", poor: "deficiente" };
const ASSESSMENT: Record<Assessment, { text: string; tone: string }> = {
  passed: { text: "Aprobada", tone: "text-ok" },
  failed: { text: "Por mejorar", tone: "text-warning" },
  "no-data": { text: "Sin veredicto", tone: "text-ink-muted" },
};

/** Una medición resumida: título, cifra grande, variación y una línea de contexto. Entera es un enlace a su desglose. */
function Card({ href, id, title, value, delta, tone, children }: { href: string; id: MeasurementId; title?: string; value: string; delta?: ReturnType<typeof percentDelta>; tone?: string; children?: ReactNode }) {
  return (
    <li className="min-w-0">
      <Link href={href} className="press hud flex h-full min-w-0 flex-col gap-0.5 rounded-lg p-3">
        <span className="flex items-start gap-1">
          <span className="min-w-0 flex-1 text-[12px] leading-4 font-semibold text-ink-muted">{title ?? MEASUREMENT_BY_ID[id].title}</span>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        </span>
        <span className={cx("text-[26px] leading-8 font-bold tracking-[-0.02em] break-words tabular-nums", tone ?? "text-ink")}>{value}</span>
        {delta ? <Delta change={delta} className="text-[13px]" /> : null}
        {children ? <span className="line-clamp-3 text-[13px] leading-[18px] break-words text-ink-muted">{children}</span> : null}
      </Link>
    </li>
  );
}

/**
 * El resumen de cada medición que no es Lighthouse, en el Resumen del portal: Búsqueda en Google, Visitas, Redes sociales, Experiencia
 * real, Salud SEO y asistentes de IA. Cada tarjeta lleva a su desglose. Lo que no está activado se nombra en una sola línea al final.
 */
export function MeasurementCards({ m, base }: { m: PortalMeasurements; base: string }) {
  const d = m.traffic?.dashboard ?? null;
  const health = m.traffic?.health ?? null;
  const to = (seccion: "visitas" | "google" | "salud") => `${base}/trafico?periodo=${m.days}&seccion=${seccion}`;
  const cards: ReactNode[] = [];

  const s = d?.search;
  if (s) {
    cards.push(
      <Card key="search" id="search" href={to("google")} value={formatCount(s.totals.clicks)} delta={percentDelta(s.totals.clicks, s.previousTotals.clicks)}>
        clics · {formatCount(s.totals.impressions)} impresiones · posición {formatPosition(s.totals.position)}
      </Card>,
    );
  }

  const tr = d?.traffic;
  if (tr) {
    const top = (d?.sources?.top ?? []).filter((x) => x.group !== "direct").slice(0, 3);
    const total = d?.sources?.totals.sessions ?? tr.totals.sessions;
    const direct = d?.sources?.groups.find((g) => g.group === "direct");
    cards.push(
      <Card key="traffic" id="traffic" href={to("visitas")} value={formatCount(tr.totals.sessions)} delta={percentDelta(tr.totals.sessions, tr.previousTotals.sessions)}>
        {top.length > 0 ? `sesiones · ${top.map((x) => `${x.label} ${share(x.sessions, total)}`).join(" · ")}${direct ? ` · Directo ${share(direct.sessions, total)}` : ""}` : "sesiones"}
      </Card>,
    );
  }

  const social = d?.social;
  if (d?.sources) {
    cards.push(
      <Card key="social" id="sources" title="Redes sociales" href={to("visitas")} value={social ? formatCount(social.totals.sessions) : "0"} delta={social ? percentDelta(social.totals.sessions, social.previousTotals.sessions) : null}>
        {social && social.byNetwork.length > 0 ? `desde redes · ${social.byNetwork.slice(0, 3).map((n) => `${n.label} ${share(n.sessions, social.totals.sessions)}`).join(" · ")}` : "visitas desde redes sociales en este periodo"}
      </Card>,
    );
  }

  const f = m.field;
  if (f) {
    const verdict = ASSESSMENT[f.assessment];
    cards.push(
      <Card key="field" id="field" href={`${base}#experiencia-real`} value={verdict.text} tone={verdict.tone}>
        {f.metrics.filter((x) => x.core).map((x) => (
          <span key={x.metric} className="mr-2 inline-block">
            {x.metric.toUpperCase()} <b className={cx("font-semibold", x.rating ? RATING_TONE[x.rating] : "text-ink-muted")}>{x.value}</b>
            <span className="sr-only">{x.rating ? ` (${RATING_WORD[x.rating]})` : ""}</span>
          </span>
        ))}
      </Card>,
    );
  }

  if (health) {
    cards.push(
      <Card key="health" id="health" href={to("salud")} value={`${health.errors} ${health.errors === 1 ? "error" : "errores"}`} tone={health.errors > 0 ? "text-danger" : "text-ok"}>
        {health.warnings} {health.warnings === 1 ? "aviso" : "avisos"} · {health.pagesCrawled} {health.pagesCrawled === 1 ? "página revisada" : "páginas revisadas"}
      </Card>,
    );
  }

  const ai = d?.ai;
  if (ai) {
    cards.push(
      <Card key="ai" id="ai" href={to("visitas")} value={formatCount(ai.totals.sessions)} delta={percentDelta(ai.totals.sessions, ai.previousTotals.sessions)}>
        sesiones · mínimo observado
      </Card>,
    );
  }

  const off = (["search", "traffic", "sources", "ai", "health"] as const).filter((id) => m.states[id] === "off");
  const pending = (["search", "traffic", "sources", "ai", "health"] as const).filter((id) => m.states[id] === "pending");
  return (
    <section aria-label="Resumen de mediciones" className="flex flex-col gap-3">
      <h2 className="text-[20px] leading-7 font-bold tracking-[-0.01em] text-ink">Tu sitio en Google y en el mundo real</h2>
      {cards.length > 0 ? <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">{cards}</ul> : null}
      {!m.seoAccess ? (
        <p className="rounded-lg bg-surface-200 p-3 text-[14px] leading-5 text-ink-muted">No activado para tu sitio: {off.map((id) => MEASUREMENT_BY_ID[id].title.toLowerCase()).join(", ")}.</p>
      ) : pending.length > 0 ? (
        <p className="rounded-lg bg-surface-200 p-3 text-[14px] leading-5 text-ink-muted">Todavía sin datos: {pending.map((id) => MEASUREMENT_BY_ID[id].title.toLowerCase()).join(", ")}. Aparecerán aquí cuando Google los entregue.</p>
      ) : null}
    </section>
  );
}
