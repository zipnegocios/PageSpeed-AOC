import { Document, Page, Text, View } from "@react-pdf/renderer";
import { Fragment } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { formatEvidence } from "@/lib/seo-crawl-format";
import { METRIC_META, formatMetric } from "@/server/domain/history";
import { formatImpact, plainImprovement } from "@/server/domain/improvement-glossary";
import type { ImprovementCategory } from "@/server/domain/improvements";
import { REPORT_GLOSSARY } from "@/server/domain/report-glossary";
import { ENGINEERING_SECTIONS, REPORT_TITLE } from "@/server/domain/report-outline";
import { formatVital, vitalTone } from "@/server/domain/vitals-band";
import { worstFirst, type ReportData } from "@/server/services/report";
import { C, Chart, pdfImpact, Note, PROFILE, ReportFooter, ReportHeader, Row, ScoreText, SectionTitle, dateFmt, s, type Col } from "./pdf-common";
import { FieldBlock, Reason, SearchBlock, TrafficBlock } from "./pdf-measures";

/** Cuántas páginas (las más débiles) se detallan en cada apartado; el resto se resume. */
export const ENGINEERING_MAX_PAGES = 30;
const CATEGORY_LABEL: Record<ImprovementCategory, string> = { performance: "Rendimiento", accessibility: "Accesibilidad", "best-practices": "Buenas prácticas", seo: "SEO" };
const METRIC_LABEL: Record<string, string> = { performance: "Rendimiento", seo: "SEO", accessibility: "Accesibilidad", best_practices: "Buenas prácticas" };
const TONE_COLOR = { ok: C.ok, warning: C.warning, danger: C.danger } as const;

const detailRows = (data: ReportData) => worstFirst(data.latest);
const routeIds = (data: ReportData) => [...new Set(detailRows(data).map((l) => l.routeId))];
const cappedRoutes = (data: ReportData) => new Set(routeIds(data).slice(0, ENGINEERING_MAX_PAGES));
const capped = (data: ReportData) => {
  const keep = cappedRoutes(data);
  return detailRows(data).filter((l) => keep.has(l.routeId));
};
const moreNote = (data: ReportData) => {
  const extra = routeIds(data).length - ENGINEERING_MAX_PAGES;
  return extra > 0 ? <Note>… y {extra} páginas más con mejor nota, que no se detallan aquí.</Note> : null;
};

function Metodo({ data }: { data: ReportData }) {
  return (
    <View>
      <Text style={s.bodyText}>
        Cada página se abre en un navegador real (Chromium) y se mide con Lighthouse{data.lighthouseVersion ? `, versión ${data.lighthouseVersion}` : ""}, la herramienta de Google para evaluar sitios web. Todas las cifras de este
        informe se leen de esas mediciones guardadas: no se estiman ni se completan a mano.
      </Text>
      <Text style={s.bodyText}>
        Cada página se mide dos veces: simulando un teléfono con conexión móvil y simulando un ordenador de escritorio. La nota de cada rubro va de 0 a 100.
      </Text>
      <View style={{ flexDirection: "row", marginTop: 4, marginBottom: 6 }}>
        {[
          ["90 a 100", "bueno", C.ok],
          ["50 a 89", "mejorable", C.warning],
          ["0 a 49", "deficiente", C.danger],
        ].map(([range, word, color]) => (
          <View key={range} style={{ flexDirection: "row", alignItems: "center", marginRight: 16 }}>
            <View style={{ width: 8, height: 8, backgroundColor: color, marginRight: 4 }} />
            <Text style={{ fontSize: 9.5 }}>{range} · {word}</Text>
          </View>
        ))}
      </View>
      <Text style={s.bodyText}>
        {data.thresholds.length > 0
          ? `Metas acordadas para este sitio: ${data.thresholds.map((t) => `${METRIC_LABEL[t.metric] ?? t.metric} ${t.minScore}`).join(" · ")}. Un rubro por debajo de su meta aparece como punto por mejorar.`
          : "Todavía no hay metas acordadas para este sitio."}
      </Text>
      <Text style={s.bodyText}>
        Las visitas y la búsqueda vienen de Google Analytics 4 y Google Search Console; la experiencia real de visitantes, del Chrome UX Report (Google); la salud SEO, de un rastreo técnico propio del sitio. Cada apartado indica si su fuente está activada para tu sitio.
      </Text>
      <Text style={s.bodyText}>
        Periodo del informe: {data.days === 365 ? "último año" : `últimos ${data.days} días`}. Páginas medidas: {routeIds(data).length}.
      </Text>
    </View>
  );
}

const NOTE_COLS: Col[] = [{ flex: 1 }, { w: 44 }, { w: 26, align: "center" }, { w: 26, align: "center" }, { w: 26, align: "center" }, { w: 26, align: "center" }, { w: 32, align: "center" }, { w: 38, align: "right" }, { w: 34, align: "right" }, { w: 40, align: "right" }];

function Notas({ data }: { data: ReportData }) {
  const rows = capped(data);
  if (rows.length === 0) return <Note>Todavía no hay auditorías de este proyecto.</Note>;
  const vital = (kind: "lcp" | "cls" | "tbt", v: number | null) => {
    const tone = vitalTone(kind, v);
    return <Text style={{ fontSize: 9, color: tone ? TONE_COLOR[tone] : C.muted, fontWeight: 700 }}>{formatVital(kind, v)}</Text>;
  };
  return (
    <View>
      <Row head cols={NOTE_COLS} cells={["Página", "Disp.", "R", "S", "A", "B", "IA", "LCP", "CLS", "TBT"]} />
      {rows.map((l) => (
        <Row
          key={`${l.routeId}-${l.profile}`}
          cols={NOTE_COLS}
          cells={[
            <Text key="t" style={{ fontSize: 9.5, fontWeight: 700 }}>{data.titles[l.path] ?? l.path}</Text>,
            <Text key="d" style={{ fontSize: 9 }}>{PROFILE[l.profile]}</Text>,
            <ScoreText key="r" value={l.scores.performance} size={9.5} />,
            <ScoreText key="s" value={l.scores.seo} size={9.5} />,
            <ScoreText key="a" value={l.scores.accessibility} size={9.5} />,
            <ScoreText key="b" value={l.scores.best_practices} size={9.5} />,
            <Text key="ia" style={{ fontSize: 9 }}>{l.agentic ? `${l.agentic.passed}/${l.agentic.total}` : "—"}</Text>,
            vital("lcp", l.metrics.lcpMs),
            vital("cls", l.metrics.cls),
            vital("tbt", l.metrics.tbtMs),
          ]}
        />
      ))}
      <Text style={[s.small, { marginTop: 4 }]}>R rendimiento · S SEO · A accesibilidad · B buenas prácticas · IA navegación agéntica · LCP carga principal · CLS estabilidad · TBT respuesta.</Text>
      {moreNote(data)}
    </View>
  );
}

type Detail = ReportData["detail"][number];
const detailsFor = (data: ReportData): Detail[] => data.detail;

function Items({ detail, category }: { detail: Detail; category: ImprovementCategory }) {
  if (!detail.improvements) return <Text style={[s.small, { marginLeft: 8 }]}>Sin detalle guardado para esta medición.</Text>;
  const items = detail.improvements.categories[category] ?? [];
  if (items.length === 0) return <Text style={[s.small, { marginLeft: 8 }]}>Sin puntos por mejorar.</Text>;
  return (
    <View>
      {items.map((it) => (
        <Text key={it.id} style={{ fontSize: 9.5, marginLeft: 8 }}>
          – {plainImprovement(it)}
          {formatImpact(it.impact) ? <Text style={{ color: C.muted }}> ({pdfImpact(formatImpact(it.impact))})</Text> : null}
        </Text>
      ))}
    </View>
  );
}

function Rendimiento({ data }: { data: ReportData }) {
  const list = detailsFor(data);
  if (list.length === 0) return <Note>Todavía no hay auditorías de este proyecto.</Note>;
  return (
    <View>
      {list.map((d) => (
        <View key={`${d.routeId}-${d.profile}`} style={s.box} wrap={false}>
          <View style={s.rowHead}>
            <Text style={{ fontSize: 10.5, fontWeight: 700 }}>{data.titles[d.path] ?? d.path} · {PROFILE[d.profile]}</Text>
            <ScoreText value={d.scores.performance} />
          </View>
          <Text style={s.small}>
            LCP {formatVital("lcp", d.metrics.lcpMs)} · CLS {formatVital("cls", d.metrics.cls)} · TBT {formatVital("tbt", d.metrics.tbtMs)}
          </Text>
          <Items detail={d} category="performance" />
        </View>
      ))}
      {moreNote(data)}
    </View>
  );
}

function Fallos({ data }: { data: ReportData }) {
  const list = detailsFor(data);
  if (list.length === 0) return <Note>Todavía no hay auditorías de este proyecto.</Note>;
  return (
    <View>
      {list.map((d) => (
        <View key={`${d.routeId}-${d.profile}`} style={s.box} wrap={false}>
          <Text style={{ fontSize: 10.5, fontWeight: 700 }}>{data.titles[d.path] ?? d.path} · {PROFILE[d.profile]}</Text>
          {(["accessibility", "best-practices", "seo"] as const).map((c) => (
            <View key={c} style={{ marginTop: 3 }}>
              <Text style={{ fontSize: 9.5, fontWeight: 700, color: C.muted }}>{CATEGORY_LABEL[c]}</Text>
              <Items detail={d} category={c} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const AG_COLS: Col[] = [{ flex: 1 }, { w: 56 }, { w: 70, align: "right" }];

function Agentes({ data }: { data: ReportData }) {
  const rows = capped(data);
  return (
    <View>
      <Text style={s.bodyText}>
        Comprobaciones de que asistentes de inteligencia artificial pueden entender y usar la página. Es una medida nueva de Lighthouse, todavía en desarrollo: se muestra como «superadas / totales», sin meta y sin generar alertas.
      </Text>
      {rows.length === 0 ? <Note>Todavía no hay auditorías de este proyecto.</Note> : null}
      {rows.length > 0 ? <Row head cols={AG_COLS} cells={["Página", "Disp.", "Superadas"]} /> : null}
      {rows.map((l) => (
        <Row key={`${l.routeId}-${l.profile}`} cols={AG_COLS} cells={[<Text key="t" style={{ fontSize: 9.5 }}>{data.titles[l.path] ?? l.path}</Text>, <Text key="d" style={{ fontSize: 9 }}>{PROFILE[l.profile]}</Text>, <Text key="a" style={{ fontSize: 9.5, fontWeight: 700 }}>{l.agentic ? `${l.agentic.passed} de ${l.agentic.total}` : "—"}</Text>]} />
      ))}
    </View>
  );
}

function SaludSeo({ data }: { data: ReportData }) {
  const h = data.seo?.health;
  if (!h) return <Reason data={data} ids={["health"]} />;
  return (
    <View>
      <Text style={s.bodyText}>
        Revisión del {dateFmt.format(h.at)}: {h.pagesCrawled} páginas revisadas{h.truncated ? " (el sitio es grande: se revisó una parte)" : ""}. {h.errors} {h.errors === 1 ? "error" : "errores"} y {h.warnings} {h.warnings === 1 ? "aviso" : "avisos"}
        {h.changes ? `; frente a la revisión anterior, ${h.changes.added} nuevos y ${h.changes.resolved} resueltos` : ""}.
      </Text>
      {h.groups.length === 0 ? <Note>Todo en orden: no encontramos errores ni avisos.</Note> : null}
      {h.groups.map((g) => (
        <View key={g.group} style={s.box}>
          <Text style={{ fontSize: 11, fontWeight: 700 }}>{g.label}</Text>
          <Text style={[s.small, { marginBottom: 3 }]}>{g.hint}</Text>
          {g.issues.map((i) => (
            <View key={i.code} style={{ marginTop: 3 }} wrap={false}>
              <Text style={{ fontSize: 9.5, fontWeight: 700, color: i.severity === "error" ? C.danger : C.warning }}>
                {i.severity === "error" ? "Error" : "Aviso"} · {i.text} — {i.pages} {i.pages === 1 ? "página" : "páginas"}
                {i.added > 0 ? ` (${i.added} ${i.added === 1 ? "nueva" : "nuevas"})` : ""}
              </Text>
              {i.rows.map((r) => {
                const note = formatEvidence(i.code, r.evidence);
                return (
                  <Text key={r.page + note} style={{ fontSize: 9, marginLeft: 8, color: C.muted }}>
                    – {r.title}
                    {note ? ` — ${note}` : ""}
                  </Text>
                );
              })}
              {i.more > 0 ? <Text style={{ fontSize: 9, marginLeft: 8, color: C.muted }}>… y {i.more} más</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Evolucion({ data }: { data: ReportData }) {
  if (data.charts.length === 0) return <Note>Todavía no hay auditorías de este proyecto.</Note>;
  return (
    <View>
      <Note>Rendimiento de cada página (las más débiles primero, hasta 8) con la meta acordada.</Note>
      {data.charts.map((c) => (
        <View key={`${c.routePath}-${c.profile}`} style={{ marginBottom: 12 }} wrap={false}>
          <Text style={s.path}>
            {data.titles[c.routePath] ?? c.routePath} <Text style={s.small}>· {PROFILE[c.profile]}</Text>
          </Text>
          {c.points.length === 0 ? <Text style={s.small}>Sin auditorías en este periodo.</Text> : <Chart chart={c} data={data} />}
          {c.ranges.length > 0 ? (
            <Text style={s.small}>
              {c.ranges.map((r) => `${METRIC_META[r.metric].label} de ${formatMetric(r.metric, r.first)} a ${formatMetric(r.metric, r.last)} (mín. ${formatMetric(r.metric, r.min)}, máx. ${formatMetric(r.metric, r.max)})`).join("  ·  ")}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Glosario() {
  return (
    <View>
      {REPORT_GLOSSARY.map((g) => (
        <View key={g.term} style={{ marginBottom: 5 }} wrap={false}>
          <Text style={{ fontSize: 10, fontWeight: 700 }}>{g.term}</Text>
          <Text style={{ fontSize: 9.5, color: C.muted }}>{g.meaning}</Text>
        </View>
      ))}
    </View>
  );
}

const BODY: Record<string, (p: { data: ReportData }) => React.ReactElement> = {
  metodo: Metodo,
  notas: Notas,
  rendimiento: Rendimiento,
  experiencia: ({ data }) => <FieldBlock data={data} detail />,
  fallos: Fallos,
  agentes: Agentes,
  trafico: ({ data }) => <TrafficBlock data={data} detail />,
  busqueda: ({ data }) => <SearchBlock data={data} detail />,
  "salud-seo": SaludSeo,
  evolucion: Evolucion,
  glosario: Glosario,
};

/** La portada del informe de ingeniería: los dos logotipos, los datos del informe y el índice de apartados. */
function Cover({ data }: { data: ReportData }) {
  return (
    <Page size="A4" style={s.page}>
      <ReportHeader data={data} eyebrow={REPORT_TITLE.engineering} extra={data.lighthouseVersion ? <Text style={s.meta}>Medido con Lighthouse {data.lighthouseVersion}</Text> : null} />
      <Text style={s.h2}>Contenido</Text>
      {ENGINEERING_SECTIONS.map((section, i) => (
        <View key={section.id} style={{ marginBottom: 7 }} wrap={false}>
          <Text style={{ fontSize: 11.5, fontWeight: 700 }}>{i + 1}. {section.title}</Text>
          {section.bullets.map((b) => (
            <Text key={b} style={{ fontSize: 9.5, color: C.muted, marginLeft: 10 }}>– {b}</Text>
          ))}
        </View>
      ))}
      <ReportFooter />
    </Page>
  );
}

/** El informe de ingeniería: portada con el índice y los apartados de `ENGINEERING_SECTIONS`, con el detalle de las 30 páginas más débiles. */
export function EngineeringDocument({ data }: { data: ReportData }) {
  return (
    <Document title={`${REPORT_TITLE.engineering} · ${data.projectName}`} author={BRAND_NAME} subject={`${REPORT_TITLE.engineering} de ${data.projectName}`} language="es">
      <Cover data={data} />
      <Page size="A4" style={s.page} wrap>
        {ENGINEERING_SECTIONS.map((section, i) => {
          const Body = BODY[section.id]!;
          return (
            // Sin envoltorio: `minPresenceAhead` solo evita un título huérfano al final de página entre hermanos directos de la página.
            <Fragment key={section.id}>
              <SectionTitle section={section} n={i + 1} />
              <Body data={data} />
            </Fragment>
          );
        })}
        <ReportFooter />
      </Page>
    </Document>
  );
}
