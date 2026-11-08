import path from "node:path";
import { Circle, Document, Font, Line, Page, Path, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_NAME, COPYRIGHT, LOGO_BOLT_PATH, LOGO_CORNERS_PATH, LOGO_FRAME_PATH, LOGO_GLYPH_VIEWBOX } from "@/lib/brand";
import { layoutChart } from "@/lib/chart-layout";
import { darkToken, lightToken } from "@/lib/tokens";
import { METRIC_META, formatMetric, type Change } from "@/server/domain/history";
import { scoreBand } from "@/server/domain/score-band";
import type { ReportChart, ReportData } from "@/server/services/report";

// Los colores salen del mismo tokens.json que el resto de la app (tema claro): nada escrito a mano.
const lightColor = lightToken;
const C = {
  page: lightColor("surface-200"),
  sunken: lightColor("surface-100"),
  border: lightColor("border"),
  ink: lightColor("ink"),
  muted: lightColor("ink-muted"),
  primary: lightColor("primary"),
  deep: lightColor("brand-deep"),
  // La marca va siempre sobre su baldosa navy, como en la app: sus colores son los del tema oscuro.
  navy: darkToken("surface-100"),
  lime: darkToken("primary"),
  frame: darkToken("brand-frame"),
  ok: lightColor("ok"),
  warning: lightColor("warning"),
  danger: lightColor("danger"),
};
const BAND_COLOR = { ok: C.ok, warning: C.warning, danger: C.danger } as const;

const FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Rajdhani",
    fonts: [500, 600, 700].map((w) => ({ src: path.join(FONT_DIR, `Rajdhani-${w}.woff`), fontWeight: w as 500 | 600 | 700 })),
  });
  // Sin cortar palabras al final de línea: en un informe técnico es más legible.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

const SCORES = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;
const PROFILE = { mobile: "Móvil", desktop: "Escritorio" } as const;
const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

const s = StyleSheet.create({
  page: { fontFamily: "Rajdhani", fontWeight: 500, fontSize: 11, color: C.ink, backgroundColor: C.page, paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40 },
  eyebrow: { fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: C.muted, textTransform: "uppercase" },
  title: { fontSize: 26, fontWeight: 700, marginTop: 2 },
  rule: { height: 2, backgroundColor: C.primary, marginTop: 8, marginBottom: 6, width: 56 },
  mono: { fontFamily: "Courier", fontSize: 9.5, color: C.muted },
  meta: { fontSize: 10.5, color: C.muted, marginTop: 2 },
  h2: { fontSize: 15, fontWeight: 700, marginTop: 18, marginBottom: 8 },
  box: { borderWidth: 0.75, borderColor: C.border, padding: 8, marginBottom: 8 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  path: { fontFamily: "Courier", fontSize: 10, fontWeight: 700 },
  grid: { flexDirection: "row" },
  cell: { flex: 1 },
  label: { fontSize: 8.5, fontWeight: 700, letterSpacing: 0.8, color: C.muted, textTransform: "uppercase" },
  big: { fontSize: 24, fontWeight: 700 },
  small: { fontFamily: "Rajdhani", fontSize: 9.5, color: C.muted },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: C.muted, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 6 },
});

/** Cambio escrito con signo (la tipografía no tiene flechas): "+5", "-11", "sin cambio". */
function changeText(c: Change | null): { text: string; color: string } | null {
  if (!c) return null;
  if (c.verdict === "same") return { text: "sin cambio", color: C.muted };
  return { text: `${c.direction === "up" ? "+" : "-"}${c.text}`, color: c.verdict === "better" ? C.ok : C.danger };
}

function ScoreCell({ label, value, change }: { label: string; value: number | null; change: { text: string; color: string } | null }) {
  const band = value === null ? null : scoreBand(value);
  return (
    <View style={s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.big, { color: band ? BAND_COLOR[band.tone] : C.muted }]}>{value === null ? "—" : String(value)}</Text>
      {band ? <Text style={[s.small, { color: BAND_COLOR[band.tone] }]}>{band.word}</Text> : null}
      {change ? <Text style={[s.small, { color: change.color }]}>{change.text}</Text> : null}
    </View>
  );
}

const W = 515;
const H = 120;
const PAD = { l: 30, r: 8, t: 8, b: 18 };

function Chart({ chart, data }: { chart: ReportChart; data: ReportData }) {
  const l = layoutChart({ points: chart.points, metric: "performance", from: data.from, to: data.generatedAt, threshold: data.performanceThreshold });
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;
  const px = (x: number) => PAD.l + (x / 100) * pw;
  const py = (y: number) => PAD.t + ph - (y / 100) * ph;
  const d = l.points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {l.yTicks.map((t) => (
        <Line key={t.label} x1={PAD.l} x2={W - PAD.r} y1={py(t.y)} y2={py(t.y)} stroke={C.border} strokeWidth={0.5} />
      ))}
      {l.yTicks.map((t) => (
        <Text key={`t${t.label}`} x={PAD.l - 5} y={py(t.y) + 3} style={{ fontFamily: "Rajdhani", fontSize: 8.5, fill: C.muted }} textAnchor="end">
          {t.label}
        </Text>
      ))}
      {l.xTicks.map((t, i) => (
        <Text key={`x${i}`} x={px(t.x)} y={H - 4} style={{ fontFamily: "Rajdhani", fontSize: 8.5, fill: C.muted }} textAnchor={i === 0 ? "start" : i === l.xTicks.length - 1 ? "end" : "middle"}>
          {t.label}
        </Text>
      ))}
      {l.threshold !== null ? (
        <>
          <Line x1={PAD.l} x2={W - PAD.r} y1={py(l.threshold)} y2={py(l.threshold)} stroke={C.danger} strokeWidth={1} strokeDasharray="4 3" />
          <Text x={PAD.l + 3} y={py(l.threshold) - 3} style={{ fontFamily: "Rajdhani", fontSize: 8.5, fontWeight: 700, fill: C.danger }}>{`Meta ${data.performanceThreshold}`}</Text>
        </>
      ) : null}
      {l.points.length > 1 ? <Path d={d} stroke={C.primary} strokeWidth={1.6} fill="none" /> : null}
      {l.points.length <= 60 ? l.points.map((p, i) => <Circle key={i} cx={px(p.x)} cy={py(p.y)} r={2.2} fill={C.primary} />) : null}
    </Svg>
  );
}

/** La marca completa (glifo, marco y esquinas sobre navy) para la primera página. */
function LogoMark({ size }: { size: number }) {
  return (
    <Svg viewBox="0 0 256 256" width={size} height={size}>
      <Rect x={0} y={0} width={256} height={256} fill={C.navy} />
      <Path d={LOGO_FRAME_PATH} fill={C.frame} />
      <Path d={LOGO_CORNERS_PATH} stroke={C.lime} strokeWidth={8} fill="none" />
      <Path d={LOGO_BOLT_PATH} fill={C.lime} />
    </Svg>
  );
}

/** El glifo solo, en el color de acento del tema claro, para el pie. */
function LogoGlyph({ height }: { height: number }) {
  const [, , w, h] = LOGO_GLYPH_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  return (
    <Svg viewBox={LOGO_GLYPH_VIEWBOX} width={(height * w) / h} height={height}>
      <Path d={LOGO_BOLT_PATH} fill={C.primary} />
    </Svg>
  );
}

function ReportDocument({ data }: { data: ReportData }) {
  const periodText = `${shortFmt.format(data.from)} – ${dateFmt.format(data.generatedAt)}`;
  return (
    <Document title={`Informe ${data.projectName}`} author={BRAND_NAME} subject={`Informe de ${data.projectName}`} language="es">
      <Page size="A4" style={s.page} wrap>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flexGrow: 1, flexShrink: 1, paddingRight: 16 }}>
            <Text style={s.eyebrow}>{data.clientName}</Text>
            <Text style={s.title}>{data.projectName}</Text>
            <View style={s.rule} />
            <Text style={s.mono}>{data.baseUrl}</Text>
            <Text style={s.meta}>
              Periodo: {periodText} ({data.days === 365 ? "1 año" : `${data.days} días`}) · Generado el {dateTimeFmt.format(data.generatedAt)} UTC
            </Text>
          </View>
          <LogoMark size={56} />
        </View>

        <Text style={s.h2} minPresenceAhead={120}>Estado actual</Text>
        {data.latest.length === 0 ? (
          <Text style={s.small}>Todavía no hay auditorías de este proyecto.</Text>
        ) : (
          data.latest.map((l) => (
            <View key={`${l.routeId}-${l.profile}`} style={s.box} wrap={false}>
              <View style={s.rowHead}>
                <Text style={s.path}>{l.path}</Text>
                <Text style={s.small}>
                  {PROFILE[l.profile]} · {dateTimeFmt.format(l.finishedAt)} UTC
                </Text>
              </View>
              <View style={s.grid}>
                {SCORES.map(([key, label]) => (
                  <ScoreCell key={key} label={label} value={l.scores[key]} change={changeText(l.changes[key])} />
                ))}
              </View>
            </View>
          ))
        )}

        {data.improvements.length > 0 ? (
          <>
            <Text style={s.h2} minPresenceAhead={80}>Puntos por mejorar</Text>
            {data.improvements.map((a, i) => (
              <View key={i} style={{ marginBottom: 5 }} wrap={false}>
                <Text style={{ fontWeight: 700, color: C.danger }}>{a.text}</Text>
                <Text style={s.small}>
                  {a.routePath} · {PROFILE[a.profile]}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {data.charts.length > 0 ? <Text style={s.h2} minPresenceAhead={190}>Evolución del rendimiento</Text> : null}
        {data.charts.map((c) => (
          <View key={`${c.routePath}-${c.profile}`} style={{ marginBottom: 12 }} wrap={false}>
            <Text style={s.path}>
              {c.routePath} <Text style={s.small}>· {PROFILE[c.profile]}</Text>
            </Text>
            {c.points.length === 0 ? <Text style={s.small}>Sin auditorías en este periodo.</Text> : <Chart chart={c} data={data} />}
            {c.ranges.length > 0 ? (
              <Text style={s.small}>
                {c.ranges.map((r) => `${METRIC_META[r.metric].label} de ${formatMetric(r.metric, r.first)} a ${formatMetric(r.metric, r.last)} (mín. ${formatMetric(r.metric, r.min)}, máx. ${formatMetric(r.metric, r.max)})`).join("  ·  ")}
              </Text>
            ) : null}
          </View>
        ))}

        <View style={s.footer} fixed>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <LogoGlyph height={11} />
            <Text style={{ marginLeft: 5 }}>Informe generado por {BRAND_NAME} · {COPYRIGHT}</Text>
          </View>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Renderiza el informe a PDF (A4 vertical). Sin I/O de red; las fuentes salen del repositorio. */
export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportDocument data={data} />);
}
