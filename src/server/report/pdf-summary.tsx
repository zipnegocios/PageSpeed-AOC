import { Document, Page, Text, View } from "@react-pdf/renderer";
import { Fragment } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { SUMMARY_SECTIONS, REPORT_TITLE } from "@/server/domain/report-outline";
import { worstFirst, type ReportChart, type ReportData } from "@/server/services/report";
import { C, Chart, pdfImpact, Note, PROFILE, ReportFooter, ReportHeader, Row, ScoreText, SectionTitle, changeText, s, type Col } from "./pdf-common";
import { FieldBlock, Reason, SearchBlock, TrafficBlock } from "./pdf-measures";

const MAX_PAGES = 30;
const MAX_IMPROVEMENT_PAGES = 12;
const ITEMS_PER_BLOCK = 3;
const CATEGORY_LABEL = { performance: "Rendimiento", accessibility: "Accesibilidad", seo: "SEO", "best-practices": "Buenas prácticas" } as const;

/** La fila de cada página para el resumen: la nota del móvil (o del escritorio si no hay móvil). */
function pageRows(data: ReportData) {
  const seen = new Set<string>();
  const rows = [];
  for (const l of worstFirst(data.latest)) {
    if (seen.has(l.routeId)) continue;
    seen.add(l.routeId);
    const pick = data.latest.find((x) => x.routeId === l.routeId && x.profile === "mobile") ?? l;
    rows.push(pick);
  }
  return rows;
}

const COLS: Col[] = [{ flex: 1 }, { w: 34, align: "center" }, { w: 34, align: "center" }, { w: 34, align: "center" }, { w: 34, align: "center" }, { w: 40, align: "center" }];

function Estado({ data }: { data: ReportData }) {
  const all = pageRows(data);
  const rows = all.slice(0, MAX_PAGES);
  if (rows.length === 0) return <Note>Todavía no hay auditorías de este proyecto.</Note>;
  return (
    <View>
      <Row head cols={COLS} cells={["Página", "R", "S", "A", "B", "IA"]} />
      {rows.map((l) => {
        const change = changeText(l.changes.performance);
        return (
          <Row
            key={l.routeId}
            cols={COLS}
            cells={[
              <View key="t">
                <Text style={{ fontSize: 10, fontWeight: 700 }}>{data.titles[l.path] ?? l.path}</Text>
                <Text style={s.small}>
                  {PROFILE[l.profile]}
                  {change ? <Text style={{ color: change.color }}> · rendimiento {change.text}</Text> : null}
                </Text>
              </View>,
              <ScoreText key="r" value={l.scores.performance} />,
              <ScoreText key="s" value={l.scores.seo} />,
              <ScoreText key="a" value={l.scores.accessibility} />,
              <ScoreText key="b" value={l.scores.best_practices} />,
              <Text key="ia" style={{ fontSize: 9.5 }}>{l.agentic ? `${l.agentic.passed}/${l.agentic.total}` : "—"}</Text>,
            ]}
          />
        );
      })}
      <Text style={[s.small, { marginTop: 4 }]}>R rendimiento · S SEO · A accesibilidad · B buenas prácticas · IA navegación agéntica (superadas / totales).</Text>
      {all.length > rows.length ? <Note>… y {all.length - rows.length} páginas más (las de mejor nota). El informe de ingeniería incluye el detalle.</Note> : null}
    </View>
  );
}

function Mejoras({ data }: { data: ReportData }) {
  const pages = data.pageImprovements.pages;
  if (pages.length === 0) return <Note>Todo está dentro de la meta acordada. No hay nada pendiente por ahora.</Note>;
  return (
    <View>
      {pages.slice(0, MAX_IMPROVEMENT_PAGES).map((p) => (
        <View key={p.path} style={s.box} wrap={false}>
          <Text style={{ fontSize: 11, fontWeight: 700 }}>{p.title}</Text>
          {p.blocks.map((b, i) => (
            <View key={i} style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 9.5, fontWeight: 700, color: C.danger }}>
                {b.category ? CATEGORY_LABEL[b.category] : "Auditoría"} · {PROFILE[b.profile]}
                {b.kind === "threshold" && b.value !== null ? ` · nota ${b.value}${b.threshold !== null ? ` (meta ${b.threshold})` : ""}` : ""}
              </Text>
              {b.kind === "audit_failure" ? <Text style={s.small}>No pudimos auditar esta página; lo estamos revisando.</Text> : null}
              {b.items.slice(0, ITEMS_PER_BLOCK).map((it) => (
                <Text key={it.id} style={{ fontSize: 9.5, marginLeft: 8 }}>
                  – {it.text}
                  {it.impact ? <Text style={{ color: C.muted }}> ({pdfImpact(it.impact)})</Text> : null}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ))}
      {pages.length > MAX_IMPROVEMENT_PAGES ? <Note>… y {pages.length - MAX_IMPROVEMENT_PAGES} páginas más con puntos por mejorar. Están en el informe de ingeniería.</Note> : null}
    </View>
  );
}

function Evolucion({ data }: { data: ReportData }) {
  const points = data.daily.map((d) => ({ at: new Date(`${d.day}T00:00:00Z`), value: d.value }));
  if (points.length < 2) return <Note>Todavía no hay suficientes mediciones en este periodo para dibujar la evolución.</Note>;
  const chart: ReportChart = { routePath: "", profile: "mobile", points, ranges: [] };
  return (
    <View wrap={false}>
      <Note>Rendimiento medio de todas las páginas, día a día.</Note>
      <Chart chart={chart} data={data} />
    </View>
  );
}

function Experiencia({ data }: { data: ReportData }) {
  return <FieldBlock data={data} detail={false} />;
}

function Trafico({ data }: { data: ReportData }) {
  return <TrafficBlock data={data} detail={false} />;
}

function Busqueda({ data }: { data: ReportData }) {
  return <SearchBlock data={data} detail={false} />;
}

function SaludSeo({ data }: { data: ReportData }) {
  const h = data.seo?.health;
  if (!h) return <Reason data={data} ids={["health"]} />;
  const top = h.groups.flatMap((g) => g.issues).sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error") || b.pages - a.pages).slice(0, 5);
  return (
    <View>
      <Text style={{ fontSize: 11 }}>
        <Text style={{ fontWeight: 700, color: h.errors > 0 ? C.danger : C.ok }}>{h.errors} {h.errors === 1 ? "error" : "errores"}</Text>
        {"  ·  "}
        <Text style={{ fontWeight: 700, color: h.warnings > 0 ? C.warning : C.ok }}>{h.warnings} {h.warnings === 1 ? "aviso" : "avisos"}</Text>
        {h.changes ? <Text style={{ color: C.muted }}>   (frente a la revisión anterior: {h.changes.added} nuevos, {h.changes.resolved} resueltos)</Text> : null}
      </Text>
      {top.length === 0 ? <Note>Todo en orden: no encontramos errores ni avisos.</Note> : null}
      {top.map((i) => (
        <Text key={i.code} style={{ fontSize: 9.5, marginLeft: 8 }}>
          – {i.text} — {i.pages} {i.pages === 1 ? "página" : "páginas"}
        </Text>
      ))}
    </View>
  );
}

const BODY: Record<string, (p: { data: ReportData }) => React.ReactElement> = { estado: Estado, mejoras: Mejoras, experiencia: Experiencia, evolucion: Evolucion, trafico: Trafico, busqueda: Busqueda, "salud-seo": SaludSeo };

/** El informe resumen: pocas páginas, en lenguaje claro, con los apartados de `SUMMARY_SECTIONS`. */
export function SummaryDocument({ data }: { data: ReportData }) {
  return (
    <Document title={`${REPORT_TITLE.summary} · ${data.projectName}`} author={BRAND_NAME} subject={`${REPORT_TITLE.summary} de ${data.projectName}`} language="es">
      <Page size="A4" style={s.page} wrap>
        <ReportHeader data={data} eyebrow={REPORT_TITLE.summary} />
        {SUMMARY_SECTIONS.map((section, i) => {
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
