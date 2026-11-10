import path from "node:path";
import { Circle, Font, Image, Line, Path, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { BRAND_NAME, COPYRIGHT, LOGO_BOLT_PATH, LOGO_CORNERS_PATH, LOGO_FRAME_PATH, LOGO_GLYPH_VIEWBOX } from "@/lib/brand";
import type { OutlineSection } from "@/server/domain/report-outline";
import { layoutChart } from "@/lib/chart-layout";
import { darkToken, lightToken } from "@/lib/tokens";
import type { Change } from "@/server/domain/history";
import { scoreBand } from "@/server/domain/score-band";
import type { ReportChart, ReportData, ReportLogo } from "@/server/services/report";

// Los colores salen del mismo tokens.json que el resto de la app (tema claro): nada escrito a mano.
const lightColor = lightToken;
export const C = {
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
export const BAND_COLOR = { ok: C.ok, warning: C.warning, danger: C.danger } as const;

const FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");
let fontsReady = false;
export function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Rajdhani",
    fonts: [500, 600, 700].map((w) => ({ src: path.join(FONT_DIR, `Rajdhani-${w}.woff`), fontWeight: w as 500 | 600 | 700 })),
  });
  // Sin cortar palabras al final de línea: en un informe técnico es más legible.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

export const SCORES = [
  ["performance", "Rendimiento"],
  ["seo", "SEO"],
  ["accessibility", "Accesibilidad"],
  ["best_practices", "Buenas prácticas"],
] as const;
export const PROFILE = { mobile: "Móvil", desktop: "Escritorio" } as const;
export const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" });
export const dateTimeFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export const shortFmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

export const s = StyleSheet.create({
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
  bodyText: { fontSize: 10.5, lineHeight: 1.35, marginBottom: 6 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 9, color: C.muted, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 6 },
});

/** Cambio escrito con signo (la tipografía no tiene flechas): "+5", "-11", "sin cambio". */
export function changeText(c: Change | null): { text: string; color: string } | null {
  if (!c) return null;
  if (c.verdict === "same") return { text: "sin cambio", color: C.muted };
  return { text: `${c.direction === "up" ? "+" : "-"}${c.text}`, color: c.verdict === "better" ? C.ok : C.danger };
}

export function ScoreCell({ label, value, change }: { label: string; value: number | null; change: { text: string; color: string } | null }) {
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

export function Chart({ chart, data }: { chart: ReportChart; data: ReportData }) {
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
export function LogoMark({ size }: { size: number }) {
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
export function LogoGlyph({ height }: { height: number }) {
  const [, , w, h] = LOGO_GLYPH_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  return (
    <Svg viewBox={LOGO_GLYPH_VIEWBOX} width={(height * w) / h} height={height}>
      <Path d={LOGO_BOLT_PATH} fill={C.primary} />
    </Svg>
  );
}


/** El logotipo del cliente sobre su fondo (blanco por defecto), sin recortarlo. Sin logotipo no dibuja nada. */
export function ClientLogoImage({ logo, width = 150, height = 44 }: { logo: ReportLogo | null; width?: number; height?: number }) {
  if (!logo) return null;
  return (
    <View style={{ width: width + 12, height: height + 12, padding: 6, backgroundColor: logo.bg ?? "#FFFFFF", borderWidth: 0.75, borderColor: C.border, justifyContent: "center", alignItems: "center" }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- imagen de react-pdf: el PDF no tiene atributo alt */}
      <Image src={{ data: logo.bytes, format: "png" }} style={{ width, height, objectFit: "contain" }} />
    </View>
  );
}

/** Cabecera de la primera página: los dos logotipos (el del cliente y el de la aplicación), el título y los datos del informe. */
export function ReportHeader({ data, eyebrow, extra }: { data: ReportData; eyebrow: string; extra?: ReactNode }) {
  const periodText = `${shortFmt.format(data.from)} – ${dateFmt.format(data.generatedAt)}`;
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        {data.logo ? <ClientLogoImage logo={data.logo} /> : <View />}
        <LogoMark size={44} />
      </View>
      <Text style={s.eyebrow}>{eyebrow} · {data.clientName}</Text>
      <Text style={s.title}>{data.projectName}</Text>
      <View style={s.rule} />
      <Text style={s.mono}>{data.baseUrl}</Text>
      <Text style={s.meta}>
        Periodo: {periodText} ({data.days === 365 ? "1 año" : `${data.days} días`}) · Generado el {dateTimeFmt.format(data.generatedAt)} UTC
      </Text>
      {extra}
    </View>
  );
}

/** Título de un apartado, con su número y un marcador de PDF (el panel de navegación del lector) con el mismo texto. */
export function SectionTitle({ section, n, minPresenceAhead = 140 }: { section: OutlineSection; n: number; minPresenceAhead?: number }) {
  const title = `${n}. ${section.title}`;
  return (
    // `bookmark` funciona en cualquier elemento al renderizar, pero los tipos de react-pdf solo lo declaran en `Page`.
    <View {...({ bookmark: title } as object)} minPresenceAhead={minPresenceAhead}>
      <Text style={s.h2}>{title}</Text>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text style={[s.small, { marginBottom: 6 }]}>{children}</Text>;
}

/** El pie de todas las páginas: marca, derechos y número de página. */
export function ReportFooter() {
  return (
    <View style={s.footer} fixed>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <LogoGlyph height={11} />
        <Text style={{ marginLeft: 5 }}>Informe generado por {BRAND_NAME} · {COPYRIGHT}</Text>
      </View>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

/** Una fila de tabla con columnas de ancho fijo (o flexible, con `flex`). */
export type Col = { w?: number; flex?: number; align?: "left" | "right" | "center" };
export function Row({ cols, cells, head = false, fill }: { cols: Col[]; cells: ReactNode[]; head?: boolean; fill?: string }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: C.border, backgroundColor: head ? C.sunken : fill }}>
      {cells.map((cell, i) => (
        <View key={i} style={{ width: cols[i]!.w, flex: cols[i]!.flex, paddingRight: 4, alignItems: cols[i]!.align === "right" ? "flex-end" : cols[i]!.align === "center" ? "center" : "flex-start" }}>
          {typeof cell === "string" || typeof cell === "number" ? <Text style={head ? s.label : { fontSize: 9.5 }}>{cell}</Text> : cell}
        </View>
      ))}
    </View>
  );
}

/** Una nota de 0 a 100 coloreada por su banda; «—» sin dato. */
export function ScoreText({ value, size = 10 }: { value: number | null | undefined; size?: number }) {
  if (value === null || value === undefined) return <Text style={{ fontSize: size, color: C.muted }}>—</Text>;
  return <Text style={{ fontSize: size, fontWeight: 700, color: BAND_COLOR[scoreBand(value).tone] }}>{String(value)}</Text>;
}

/** El impacto sin «≈»: la tipografía del informe (Rajdhani) no trae ese símbolo y caería a Helvetica. */
export const pdfImpact = (impact: string): string => impact.replace("≈ ", "aprox. ");
