import Link from "next/link";
import type { ReactNode } from "react";
import { SeoChart } from "@/app/_components/seo/seo-chart";
import { AI_VISITS_NOTE } from "@/app/_components/seo/seo-data-section";
import { formatDate } from "@/lib/audit-format";
import { formatEvidence } from "@/lib/seo-crawl-format";
import { formatCount, formatDayMedium, formatPercent, formatPosition, percentDelta, positionDelta } from "@/lib/seo-format";
import { cx } from "@/lib/ui/cx";
import { Delta } from "@/lib/ui/components/delta";
import { channelLabel, SEO_PERIODS, SEO_PERIOD_LABEL } from "@/server/domain/seo-data";
import { SOURCE_GROUPS, type SourceGroup } from "@/server/domain/seo-sources";
import type { PortalHealthGroup, PortalHealthIssue, PortalTraffic } from "@/server/services/portal-traffic";
import { ChevronRight } from "./portal-icons";

export type TrafficSection = "visitas" | "google" | "salud";
export const TRAFFIC_SECTIONS: readonly TrafficSection[] = ["visitas", "google", "salud"];
export const parseTrafficSection = (raw: string | string[] | undefined): TrafficSection | null => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return TRAFFIC_SECTIONS.find((s) => s === v) ?? null;
};

/** Grupos de fuentes con desglose propio (las redes y la IA tienen su tarjeta aparte; «Directo» no tiene detalle que mostrar). */
const DETAIL_GROUPS: readonly SourceGroup[] = SOURCE_GROUPS.filter((g) => g !== "direct" && g !== "social" && g !== "ai");
const GROUP_TITLE: Record<SourceGroup, string> = {
  search: "Buscadores",
  social: "Redes sociales",
  direct: "Directo o sin identificar",
  referral: "Otros sitios que te enlazan",
  ai: "Asistentes de IA",
  email: "Correo electrónico",
  paid: "Anuncios",
  other: "Otras fuentes",
};
const DIRECT_NOTE =
  "«Directo o sin identificar» incluye a quien escribe tu dirección, usa un marcador o llega desde aplicaciones que no informan de dónde vienen (por ejemplo, mensajes privados). Para saber más, comparte tus enlaces con parámetros UTM.";

const share = (value: number, total: number) => (total > 0 ? formatPercent(value / total) : "—");

/** Control segmentado al estilo de iOS: opciones de igual ancho, la elegida resaltada. Son enlaces: la elección vive en la dirección. */
function Segment({ label, items }: { label: string; items: Array<{ label: ReactNode; href: string; current: boolean }> }) {
  return (
    <nav aria-label={label} className="flex rounded-[10px] bg-surface-300 p-0.5">
      {items.map((it, i) => (
        <Link
          key={i}
          href={it.href}
          scroll={false}
          aria-current={it.current ? "page" : undefined}
          className={cx(
            "press flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[14px] font-semibold",
            it.current ? "bg-surface-200 text-ink shadow-[0_1px_3px_rgba(17,24,39,0.18)]" : "text-ink-muted",
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

function Kpi({ label, value, delta, hint }: { label: string; value: string | null; delta?: ReturnType<typeof percentDelta>; hint?: string }) {
  return (
    <li className="hud flex min-w-0 flex-col gap-0.5 rounded-lg p-3">
      <span className="text-[12px] leading-4 font-semibold text-ink-muted">{label}</span>
      <span className={cx("text-[26px] leading-8 font-bold tracking-[-0.02em] tabular-nums", value === null ? "text-ink-muted" : "text-ink")}>{value ?? "—"}</span>
      {delta ? <Delta change={delta} /> : null}
      {hint ? <span className="text-[12px] leading-4 text-ink-muted">{hint}</span> : null}
    </li>
  );
}

type Row = { key: string; label: string; value: number };

/** Lista de barras: cada fila con su valor y su porcentaje del total. La barra es decoración; el número siempre está. */
function Bars({ rows, total, unit }: { rows: Row[]; total: number; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3 text-[15px] leading-5">
            <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              <b className="font-semibold text-ink">{formatCount(r.value)}</b> {unit} · {share(r.value, total)}
            </span>
          </span>
          <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-300">
            <span className="block h-full rounded-full bg-chart-1" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tarjeta que se abre: cerrada muestra su dato principal; abierta, el desglose. */
function Fold({ title, headline, children, open = false }: { title: string; headline?: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="hud rounded-lg">
      <summary className="press flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[17px] leading-6 font-semibold text-ink">{title}</span>
          {headline ? <span className="truncate text-[14px] leading-5 text-ink-muted">{headline}</span> : null}
        </span>
        <ChevronRight className="chev shrink-0 text-ink-muted" />
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-4">{children}</div>
    </details>
  );
}

const headlineOf = (rows: Row[], total: number, unit: string) => (rows[0] ? `${rows[0].label} ${share(rows[0].value, total)}` : `Sin ${unit}`);

function Visits({ t, d }: { t: PortalTraffic; d: NonNullable<PortalTraffic["dashboard"]> }) {
  const tr = d.traffic;
  const ai = d.ai;
  const social = d.social;
  if (!tr && !ai && !social) return <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Aún no hay datos de visitas al sitio para este periodo.</p>;
  const total = tr?.totals.sessions ?? 0;
  const channels: Row[] = (tr?.channels ?? []).map((c) => ({ key: c.channel, label: channelLabel(c.channel), value: c.sessions }));
  const countries: Row[] = (tr?.countries ?? []).map((c) => ({ key: c.country, label: c.country, value: c.sessions }));
  const pages: Row[] = (tr?.topPages ?? []).map((p) => ({ key: p.page, label: t.titles[p.page] ?? p.page, value: p.sessions }));
  const sources: Row[] = (ai?.bySource ?? []).map((s) => ({ key: s.source, label: s.source, value: s.sessions }));
  const aiTotal = ai?.totals.sessions ?? 0;
  const networks: Row[] = (social?.byNetwork ?? []).map((n) => ({ key: n.network, label: n.label, value: n.sessions }));
  const socialTotal = social?.totals.sessions ?? 0;
  const socialPages: Row[] = (social?.topPages ?? []).map((p) => ({ key: p.page, label: t.titles[p.page] ?? p.page, value: p.sessions }));
  const socialDelta = social ? percentDelta(social.totals.sessions, social.previousTotals.sessions) : null;
  const src = d.sources;
  const groupRows: Row[] = (src?.groups ?? []).map((g) => ({ key: g.group, label: g.label, value: g.sessions })).sort((a, b) => b.value - a.value);
  const srcDelta = src ? percentDelta(src.totals.sessions, src.previousTotals.sessions) : null;
  const directShare = src?.groups.find((g) => g.group === "direct")?.sessions ?? 0;
  const itemsOf = (g: SourceGroup): Row[] => (src?.items ?? []).filter((x) => x.group === g).map((x) => ({ key: `${x.group}:${x.key}`, label: x.label, value: x.sessions }));
  return (
    <>
      {tr ? <SeoChart title="Sesiones por día" unit="sesiones" series={tr.daily.map((p) => ({ date: p.date, value: p.sessions }))} tone={2} /> : null}
      {src ? (
        <>
          <Fold title="De dónde llegan" headline={headlineOf(groupRows, src.totals.sessions, "visitas")} open>
            <p className="text-[14px] leading-5 text-ink-muted">Todas las visitas del periodo repartidas por su origen: suman el 100 %.</p>
            {srcDelta ? <Delta change={srcDelta} /> : null}
            <Bars rows={groupRows} total={src.totals.sessions} unit="sesiones" />
            {directShare > 0 ? <p className="text-[13px] leading-5 text-ink-muted">{DIRECT_NOTE}</p> : null}
          </Fold>
          {DETAIL_GROUPS.map((g) => {
            const rows = itemsOf(g);
            if (rows.length === 0) return null;
            const groupTotal = src.groups.find((x) => x.group === g)?.sessions ?? 0;
            return (
              <Fold key={g} title={GROUP_TITLE[g]} headline={`${rows[0]!.label} ${share(rows[0]!.value, groupTotal)} · ${formatCount(groupTotal)} sesiones`}>
                <Bars rows={rows} total={groupTotal} unit="sesiones" />
              </Fold>
            );
          })}
        </>
      ) : channels.length > 0 ? (
        <Fold title="Canales de origen" headline={headlineOf(channels, total, "visitas")} open>
          <Bars rows={channels} total={total} unit="sesiones" />
        </Fold>
      ) : null}
      <Fold title="Redes sociales" headline={networks[0] ? `${networks[0].label} ${share(networks[0].value, socialTotal)} · ${formatCount(socialTotal)} sesiones` : "Sin visitas en este periodo"} open={networks.length > 0}>
        {networks.length === 0 ? (
          <p className="text-[14px] leading-5 text-ink-muted">Todavía no hay visitas desde redes sociales en este periodo. Cuando lleguen de Facebook, Instagram, LinkedIn, TikTok, WhatsApp u otras, aparecerán aquí con su red.</p>
        ) : (
          <>
            <p className="text-[14px] leading-5 text-ink-muted">
              Las redes que más visitas te traen. Es un mínimo: los mensajes privados (WhatsApp, Telegram) y algunas aplicaciones llegan sin referido y se cuentan como «Directo o sin identificar».
            </p>
            {socialDelta ? <Delta change={socialDelta} /> : null}
            <Bars rows={networks} total={socialTotal} unit="sesiones" />
            {socialPages.length > 0 ? (
              <>
                <p className="text-[13px] leading-5 font-semibold text-ink-muted">Páginas a las que llegan desde las redes</p>
                <Bars rows={socialPages} total={socialTotal} unit="sesiones" />
              </>
            ) : null}
          </>
        )}
      </Fold>
      {pages.length > 0 ? (
        <Fold title="Páginas más visitadas" headline={`${pages[0]!.label} · ${formatCount(pages[0]!.value)} sesiones`}>
          <Bars rows={pages} total={total} unit="sesiones" />
        </Fold>
      ) : null}
      {countries.length > 0 ? (
        <Fold title="Países" headline={headlineOf(countries, total, "visitas")}>
          <Bars rows={countries} total={total} unit="sesiones" />
        </Fold>
      ) : null}
      {sources.length > 0 ? (
        <Fold title="Desde asistentes de IA" headline={`Mínimo observado · ${formatCount(aiTotal)} sesiones`}>
          <p className="text-[14px] leading-5 text-ink-muted">{AI_VISITS_NOTE}</p>
          <Bars rows={sources} total={aiTotal} unit="sesiones" />
        </Fold>
      ) : null}
    </>
  );
}

function Google({ t, d }: { t: PortalTraffic; d: NonNullable<PortalTraffic["dashboard"]> }) {
  const s = d.search;
  if (!s) return <p className="rounded-lg bg-surface-200 p-4 text-ink-muted">Aún no hay datos de búsqueda en Google para este periodo.</p>;
  const p = s.previousTotals;
  const pages: Row[] = s.topPages.map((x) => ({ key: x.page, label: t.titles[x.page] ?? x.page, value: x.clicks }));
  const countries: Row[] = s.countries.map((x) => ({ key: x.country, label: x.name, value: x.clicks }));
  const devices: Row[] = s.devices.map((x) => ({ key: x.device, label: x.label, value: x.clicks }));
  const languages: Row[] = (d.languages ?? []).map((x) => ({ key: x.lang, label: x.label, value: x.clicks }));
  const total = s.totals.clicks;
  const queries: Row[] = (s.topQueries ?? []).map((x) => ({ key: x.query, label: x.query, value: x.clicks }));
  return (
    <>
      <ul className="grid grid-cols-2 gap-3">
        <Kpi label="CTR" value={formatPercent(s.totals.ctr)} hint="Clics por cada impresión" />
        <Kpi label="Posición media" value={formatPosition(s.totals.position)} delta={positionDelta(s.totals.position, p.position)} hint="Menos es mejor" />
      </ul>
      <SeoChart title="Clics por día" unit="clics" series={s.daily.map((x) => ({ date: x.date, value: x.clicks }))} tone={1} />
      {queries.length > 0 ? (
        <Fold title="Con qué buscan" headline={`«${queries[0]!.label}» · ${formatCount(queries[0]!.value)} clics`} open>
          <p className="text-[14px] leading-5 text-ink-muted">Las búsquedas en Google que más visitas te trajeron en este periodo. Google no entrega todas: las poco frecuentes se ocultan por privacidad.</p>
          <Bars rows={queries} total={total} unit="clics" />
        </Fold>
      ) : null}
      {pages.length > 0 ? (
        <Fold title="Páginas con más clics" headline={`${pages[0]!.label} · ${formatCount(pages[0]!.value)} clics`} open>
          <Bars rows={pages} total={total} unit="clics" />
        </Fold>
      ) : null}
      {countries.length > 0 ? (
        <Fold title="Países" headline={headlineOf(countries, total, "clics")}>
          <Bars rows={countries} total={total} unit="clics" />
        </Fold>
      ) : null}
      {devices.length > 0 ? (
        <Fold title="Dispositivos" headline={headlineOf(devices, total, "clics")}>
          <Bars rows={devices} total={total} unit="clics" />
        </Fold>
      ) : null}
      {languages.length > 1 ? (
        <Fold title="Por idioma" headline={headlineOf(languages, languages.reduce((a, l) => a + l.value, 0), "clics")}>
          <Bars rows={languages} total={languages.reduce((a, l) => a + l.value, 0)} unit="clics" />
        </Fold>
      ) : null}
    </>
  );
}

function Issue({ issue }: { issue: PortalHealthIssue }) {
  return (
    <li>
      <details className="rounded-lg bg-surface-100">
        <summary className="press flex min-h-12 items-start gap-2 rounded-lg px-3 py-2">
          <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", issue.severity === "error" ? "bg-danger" : "bg-warning")} aria-hidden />
          <span className="min-w-0 flex-1 text-[15px] leading-5 text-ink">
            {issue.text}
            <span className="sr-only">{issue.severity === "error" ? " (error)" : " (aviso)"}</span>
          </span>
          <span className="shrink-0 text-[13px] leading-5 whitespace-nowrap text-ink-muted tabular-nums">
            {issue.pages} {issue.pages === 1 ? "página" : "páginas"}
            {issue.added > 0 ? <b className="ml-1 font-semibold text-danger">· {issue.added} {issue.added === 1 ? "nueva" : "nuevas"}</b> : null}
          </span>
        </summary>
        <ul className="flex flex-col gap-2 px-3 pb-3">
          {issue.rows.map((r) => {
            const note = formatEvidence(issue.code, r.evidence);
            return (
              <li key={r.page + note} className="flex flex-col text-[14px] leading-5">
                <span className="font-semibold text-ink">{r.title}</span>
                {note ? <span className="text-ink-muted">{note}</span> : null}
              </li>
            );
          })}
          {issue.more > 0 ? <li className="text-[14px] text-ink-muted">y {issue.more} más</li> : null}
        </ul>
      </details>
    </li>
  );
}

function HealthGroup({ g, open }: { g: PortalHealthGroup; open: boolean }) {
  const parts = [g.errors > 0 ? `${g.errors} ${g.errors === 1 ? "error" : "errores"}` : null, g.warnings > 0 ? `${g.warnings} ${g.warnings === 1 ? "aviso" : "avisos"}` : null].filter(Boolean).join(" · ");
  return (
    <Fold title={g.label} headline={parts} open={open}>
      <p className="text-[14px] leading-5 text-ink-muted">{g.hint}</p>
      <ul className="flex flex-col gap-2">
        {g.issues.map((i) => (
          <Issue key={i.code} issue={i} />
        ))}
      </ul>
    </Fold>
  );
}

function Health({ health }: { health: NonNullable<PortalTraffic["health"]> }) {
  return (
    <>
      <div className="hud flex flex-col gap-2 rounded-lg p-3">
        <p className="text-[14px] leading-5 text-ink-muted">
          Revisión del {formatDate(health.at)} · {health.pagesCrawled} {health.pagesCrawled === 1 ? "página revisada" : "páginas revisadas"}
          {health.truncated ? " (el sitio es grande: se revisó una parte)" : ""}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[17px] leading-6 font-semibold">
          <span className={health.errors > 0 ? "text-danger" : "text-ok"}>
            {health.errors} {health.errors === 1 ? "error" : "errores"}
          </span>
          <span className={health.warnings > 0 ? "text-warning" : "text-ok"}>
            {health.warnings} {health.warnings === 1 ? "aviso" : "avisos"}
          </span>
        </p>
        {health.changes ? (
          <p className="text-[14px] leading-5 text-ink-muted">
            Frente a la revisión anterior: <b className="font-semibold text-ink">{health.changes.added}</b> {health.changes.added === 1 ? "nuevo" : "nuevos"} · <b className="font-semibold text-ink">{health.changes.resolved}</b> {health.changes.resolved === 1 ? "resuelto" : "resueltos"}
          </p>
        ) : null}
      </div>
      {health.groups.length === 0 ? (
        <p className="rounded-lg bg-surface-200 p-4 text-ink">Todo en orden: no encontramos errores ni avisos en esta revisión.</p>
      ) : (
        health.groups.map((g, i) => <HealthGroup key={g.group} g={g} open={i === 0} />)
      )}
    </>
  );
}

/** La pestaña «Tráfico»: periodo, cifras clave y tres secciones (Visitas, Google, Salud SEO) con tarjetas que se abren. */
export function PortalTrafficView({ data, section, basePath }: { data: PortalTraffic; section: TrafficSection; basePath: string }) {
  const d = data.dashboard;
  const href = (patch: { periodo?: number; seccion?: TrafficSection }) => {
    const q = new URLSearchParams({ periodo: String(patch.periodo ?? data.days), seccion: patch.seccion ?? section });
    return `${basePath}?${q.toString()}`;
  };
  const s = d?.search;
  const tr = d?.traffic;
  const ai = d?.ai;
  const errors = data.health?.errors ?? 0;
  const items: Array<{ id: TrafficSection; label: ReactNode }> = [
    ...(d ? [{ id: "visitas" as const, label: "Visitas" }, { id: "google" as const, label: "Google" }] : []),
    ...(data.health ? [{ id: "salud" as const, label: <>Salud SEO{errors > 0 ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[12px] leading-5 font-semibold text-white">{errors}</span> : null}</> }] : []),
  ];
  return (
    <>
      {d ? (
        <>
          <Segment label="Periodo" items={SEO_PERIODS.map((p) => ({ label: SEO_PERIOD_LABEL[p], href: href({ periodo: p }), current: p === data.days }))} />
          <p className="text-[13px] leading-5 text-ink-muted">
            {[d.sync.gsc?.syncedThrough ? `Google hasta el ${formatDayMedium(d.sync.gsc.syncedThrough)}` : null, d.sync.ga4?.syncedThrough ? `visitas hasta el ${formatDayMedium(d.sync.ga4.syncedThrough)}` : null].filter(Boolean).join(" · ")} · se actualiza cada día
          </p>
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi label="Clics en Google" value={s ? formatCount(s.totals.clicks) : null} delta={s ? percentDelta(s.totals.clicks, s.previousTotals.clicks) : null} />
            <Kpi label="Impresiones" value={s ? formatCount(s.totals.impressions) : null} delta={s ? percentDelta(s.totals.impressions, s.previousTotals.impressions) : null} />
            <Kpi label="Sesiones" value={tr ? formatCount(tr.totals.sessions) : null} delta={tr ? percentDelta(tr.totals.sessions, tr.previousTotals.sessions) : null} />
            <Kpi label="Visitas desde IA" value={ai ? formatCount(ai.totals.sessions) : null} delta={ai ? percentDelta(ai.totals.sessions, ai.previousTotals.sessions) : null} hint="Mínimo observado" />
          </ul>
        </>
      ) : null}
      {items.length > 1 ? <Segment label="Sección" items={items.map((i) => ({ label: i.label, href: href({ seccion: i.id }), current: i.id === section }))} /> : null}
      {section === "salud" && data.health ? <Health health={data.health} /> : null}
      {section === "visitas" && d ? <Visits t={data} d={d} /> : null}
      {section === "google" && d ? <Google t={data} d={d} /> : null}
    </>
  );
}
