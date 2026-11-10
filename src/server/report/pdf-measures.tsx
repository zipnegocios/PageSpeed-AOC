import { Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { formatCount, formatPercent, formatPosition, percentDelta } from "@/lib/seo-format";
import type { MeasurementId } from "@/server/domain/measurements";
import { MEASUREMENT_BY_ID } from "@/server/domain/measurements";
import { SOURCE_GROUP_LABEL, type SourceGroup } from "@/server/domain/seo-sources";
import type { ReportData } from "@/server/services/report";
import { C, Note, changeText, s } from "./pdf-common";

export const DIRECT_NOTE =
  "«Directo o sin identificar» incluye a quien escribe la dirección, usa un marcador o llega desde aplicaciones que no informan de dónde vienen (por ejemplo, mensajes privados). Para saber más, comparte tus enlaces con parámetros UTM.";
export const RATING_WORD = { good: "bueno", "needs-improvement": "mejorable", poor: "deficiente" } as const;
const RATING_COLOR = { good: C.ok, "needs-improvement": C.warning, poor: C.danger } as const;
export const ASSESSMENT_TEXT = { passed: "aprobada", failed: "no aprobada", "no-data": "sin veredicto" } as const;

export const share = (value: number, total: number) => (total > 0 ? formatPercent(value / total) : "—");

/** El motivo cuando un apartado no trae datos: no activado para el cliente, o activado pero Google aún no entrega nada. */
export function Reason({ data, ids }: { data: ReportData; ids: readonly MeasurementId[] }) {
  const pending = ids.some((id) => data.states[id] === "pending");
  const what = ids.map((id) => MEASUREMENT_BY_ID[id].title.toLowerCase()).join(", ");
  return pending ? (
    <Note>Todavía no hay datos de {what} en este periodo. Aparecerán en el informe cuando la fuente los entregue.</Note>
  ) : (
    <Note>Este apartado ({what}) se incluye cuando se activa para tu sitio. Si te interesa, pídelo a tu contacto.</Note>
  );
}

export function Kpi({ label, value, delta }: { label: string; value: string; delta?: ReturnType<typeof percentDelta> }) {
  const c = changeText(delta ?? null);
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: 700 }}>{value}</Text>
      {c ? <Text style={[s.small, { color: c.color }]}>{c.text}</Text> : null}
    </View>
  );
}

export type BarRow = { label: string; value: number };

/** Filas con valor, porcentaje y una barra fina. La barra es adorno: el número siempre está escrito. */
export function BarList({ rows, total, unit }: { rows: BarRow[]; total: number; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View style={{ marginBottom: 6 }}>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={{ marginBottom: 3 }} wrap={false}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 9.5, flex: 1, paddingRight: 8 }}>{r.label}</Text>
            <Text style={{ fontSize: 9.5, color: C.muted }}>
              <Text style={{ fontWeight: 700, color: C.ink }}>{formatCount(r.value)}</Text> {unit} · {share(r.value, total)}
            </Text>
          </View>
          <View style={{ height: 3, backgroundColor: C.sunken }}>
            <View style={{ height: 3, width: `${Math.max(2, (r.value / max) * 100)}%`, backgroundColor: C.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={[s.label, { marginTop: 6, marginBottom: 3 }]}>{children}</Text>;
}

/** Las visitas repartidas por origen (los grupos suman el total) y las redes sociales por nombre. `detail`: desglose de cada grupo. */
export function SourcesBlock({ data, detail }: { data: ReportData; detail: boolean }) {
  const d = data.seo?.dashboard;
  const src = d?.sources;
  if (!d || !src) return null;
  const groups = [...src.groups].sort((a, b) => b.sessions - a.sessions);
  const direct = groups.find((g) => g.group === "direct");
  const social = d.social;
  const itemsOf = (g: SourceGroup) => src.items.filter((i) => i.group === g).slice(0, 8);
  const DETAIL: readonly SourceGroup[] = ["search", "referral", "email", "paid", "other"];
  return (
    <View>
      <Subtitle>De dónde llegan las visitas</Subtitle>
      <BarList rows={groups.map((g) => ({ label: g.label, value: g.sessions }))} total={src.totals.sessions} unit="sesiones" />
      {social && social.byNetwork.length > 0 ? (
        <View>
          <Subtitle>Redes sociales, por nombre</Subtitle>
          <BarList rows={social.byNetwork.slice(0, detail ? 12 : 5).map((n) => ({ label: n.label, value: n.sessions }))} total={social.totals.sessions} unit="sesiones" />
        </View>
      ) : null}
      {detail
        ? DETAIL.map((g) => {
            const rows = itemsOf(g);
            const total = groups.find((x) => x.group === g)?.sessions ?? 0;
            return rows.length > 0 ? (
              <View key={g}>
                <Subtitle>{SOURCE_GROUP_LABEL[g]}</Subtitle>
                <BarList rows={rows.map((r) => ({ label: r.label, value: r.sessions }))} total={total} unit="sesiones" />
              </View>
            ) : null;
          })
        : null}
      {direct && direct.sessions > 0 ? <Note>{DIRECT_NOTE}</Note> : null}
    </View>
  );
}

/** Experiencia real de los visitantes (Chrome UX Report). `detail`: los cinco indicadores con su reparto, en cada dispositivo. */
export function FieldBlock({ data, detail }: { data: ReportData; detail: boolean }) {
  const list = detail ? data.fields : data.fields.slice(0, 1);
  if (list.length === 0) return <Reason data={data} ids={["field"]} />;
  return (
    <View>
      <Note>Cómo vivieron la velocidad de tu sitio visitantes reales de Chrome en los últimos 28 días. El valor es el percentil 75: tres de cada cuatro visitas lo igualan o lo mejoran.</Note>
      {list.map((f) => (
        <View key={f.device} style={s.box} wrap={false}>
          <Text style={{ fontSize: 10.5, fontWeight: 700 }}>
            {f.device === "mobile" ? "Móvil" : "Escritorio"} · evaluación de Core Web Vitals: {ASSESSMENT_TEXT[f.assessment]}
          </Text>
          {f.metrics
            .filter((m) => detail || m.core)
            .map((m) => (
              <Text key={m.metric} style={{ fontSize: 9.5, marginTop: 2 }}>
                {m.label}: <Text style={{ fontWeight: 700, color: m.rating ? RATING_COLOR[m.rating] : C.muted }}>{m.value}</Text>
                {m.rating ? ` · ${RATING_WORD[m.rating]}` : ""}
                {detail ? <Text style={{ color: C.muted }}> (bueno {m.good} % · mejorable {m.needsImprovement} % · deficiente {m.poor} %)</Text> : null}
              </Text>
            ))}
        </View>
      ))}
    </View>
  );
}

/** Búsqueda en Google (Search Console): cifras, consultas y páginas; `detail` añade países, dispositivos e idiomas. */
export function SearchBlock({ data, detail }: { data: ReportData; detail: boolean }) {
  const d = data.seo?.dashboard;
  const sr = d?.search;
  if (!d || !sr) return <Reason data={data} ids={["search"]} />;
  const titles = data.seo!.titles;
  const limit = detail ? 10 : 5;
  const languages = (d.languages ?? []).filter(() => detail);
  return (
    <View>
      <View style={[s.grid, { marginBottom: 8 }]}>
        <Kpi label="Clics en Google" value={formatCount(sr.totals.clicks)} delta={percentDelta(sr.totals.clicks, sr.previousTotals.clicks)} />
        <Kpi label="Impresiones" value={formatCount(sr.totals.impressions)} delta={percentDelta(sr.totals.impressions, sr.previousTotals.impressions)} />
        <Kpi label="CTR" value={formatPercent(sr.totals.ctr)} />
        <Kpi label="Posición media" value={formatPosition(sr.totals.position)} />
      </View>
      {sr.topQueries.length > 0 ? (
        <View>
          <Subtitle>Con qué buscan</Subtitle>
          <BarList rows={sr.topQueries.slice(0, limit).map((q) => ({ label: `«${q.query}»${q.position !== null && detail ? ` · posición ${formatPosition(q.position)}` : ""}`, value: q.clicks }))} total={sr.totals.clicks} unit="clics" />
        </View>
      ) : null}
      {sr.topPages.length > 0 ? (
        <View>
          <Subtitle>Páginas con más clics</Subtitle>
          <BarList rows={sr.topPages.slice(0, limit).map((p) => ({ label: titles[p.page] ?? p.page, value: p.clicks }))} total={sr.totals.clicks} unit="clics" />
        </View>
      ) : null}
      {detail && sr.countries.length > 0 ? (
        <View>
          <Subtitle>Países</Subtitle>
          <BarList rows={sr.countries.slice(0, 8).map((c) => ({ label: c.name, value: c.clicks }))} total={sr.totals.clicks} unit="clics" />
        </View>
      ) : null}
      {detail && sr.devices.length > 0 ? (
        <View>
          <Subtitle>Dispositivos</Subtitle>
          <BarList rows={sr.devices.map((c) => ({ label: c.label, value: c.clicks }))} total={sr.totals.clicks} unit="clics" />
        </View>
      ) : null}
      {languages.length > 1 ? (
        <View>
          <Subtitle>Por idioma</Subtitle>
          <BarList rows={languages.map((l) => ({ label: l.label, value: l.clicks }))} total={languages.reduce((a, l) => a + l.clicks, 0)} unit="clics" />
        </View>
      ) : null}
    </View>
  );
}

/** Visitas (GA4): cifras, origen, redes, asistentes de IA y páginas; `detail` añade usuarios, países y más páginas. */
export function TrafficBlock({ data, detail }: { data: ReportData; detail: boolean }) {
  const d = data.seo?.dashboard;
  if (!d || (!d.traffic && !d.sources && !d.ai)) return <Reason data={data} ids={["traffic", "sources", "ai"]} />;
  const tr = d.traffic;
  const ai = d.ai;
  const titles = data.seo!.titles;
  return (
    <View>
      <View style={[s.grid, { marginBottom: 8 }]}>
        <Kpi label="Sesiones" value={tr ? formatCount(tr.totals.sessions) : "—"} delta={tr ? percentDelta(tr.totals.sessions, tr.previousTotals.sessions) : null} />
        {detail ? <Kpi label="Usuarios" value={tr ? formatCount(tr.totals.users) : "—"} delta={tr ? percentDelta(tr.totals.users, tr.previousTotals.users) : null} /> : null}
        <Kpi label="Visitas desde IA (mínimo)" value={ai ? formatCount(ai.totals.sessions) : "—"} delta={ai ? percentDelta(ai.totals.sessions, ai.previousTotals.sessions) : null} />
      </View>
      <SourcesBlock data={data} detail={detail} />
      {ai && ai.bySource.length > 0 ? (
        <View>
          <Subtitle>Asistentes de IA (mínimo observado)</Subtitle>
          <BarList rows={ai.bySource.slice(0, detail ? 8 : 4).map((x) => ({ label: x.source, value: x.sessions }))} total={ai.totals.sessions} unit="sesiones" />
        </View>
      ) : null}
      {tr && tr.topPages.length > 0 ? (
        <View>
          <Subtitle>Páginas más visitadas</Subtitle>
          <BarList rows={tr.topPages.slice(0, detail ? 10 : 5).map((p) => ({ label: titles[p.page] ?? p.page, value: p.sessions }))} total={tr.totals.sessions} unit="sesiones" />
        </View>
      ) : null}
      {detail && tr && tr.countries.length > 0 ? (
        <View>
          <Subtitle>Países</Subtitle>
          <BarList rows={tr.countries.slice(0, 8).map((c) => ({ label: c.country, value: c.sessions }))} total={tr.totals.sessions} unit="sesiones" />
        </View>
      ) : null}
    </View>
  );
}
