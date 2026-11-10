import { describe, expect, it } from "vitest";
import {
  buildClientReportEmail,
  buildMonthlyEmail,
  buildWeeklyEmail,
  buildWelcomeEmail,
  formatCount,
  formatPct,
  formatPoints,
  greeting,
  type ClientEmailBase,
  type MonthlyInput,
  type WeeklyInput,
} from "@/server/notify/client-emails";

const base: ClientEmailBase = {
  names: ["Ana", "Luis", "María"],
  clientName: "Café Aurora",
  site: "cafeaurora.com",
  appUrl: "https://app.example.com",
  portalUrl: "https://app.example.com/c/cafe-aurora",
};
const one: ClientEmailBase = { ...base, names: ["Ana"] };

const monthly: MonthlyInput = {
  ...base,
  monthLabel: "octubre",
  prevMonthLabel: "septiembre",
  tone: "ok",
  statusLine: "Todo en orden.",
  scores: [
    { label: "Rendimiento", mobile: 78, desktop: 91, mobileDelta: 5, desktopDelta: -2 },
    { label: "Accesibilidad", mobile: 88, desktop: 88, mobileDelta: 0, desktopDelta: 0 },
  ],
  serverConfirmed: false,
  actions: [],
  upcoming: null,
  newPages: null,
  reportUrl: null,
};

const weekly: WeeklyInput = {
  ...base,
  rangeLabel: "2 al 8 de noviembre",
  rangeShort: "2 al 8 de nov",
  visits: 1240,
  visitsDeltaPct: 8,
  googleClicks: 310,
  clicksDeltaPct: 12,
  impressions: 9800,
  sources: [
    { label: "Google (búsqueda)", visits: 610, deltaPct: 11 },
    { label: "TikTok", visits: 40, deltaPct: null },
  ],
  topPages: [{ label: "Inicio", visits: 480 }],
  summaryLine: "Semana estable.",
  dataThrough: "8 de nov",
};

describe("formato", () => {
  it("agrupa miles con punto, también los de cuatro cifras", () => {
    expect(formatCount(1240)).toBe("1.240");
    expect(formatCount(9800)).toBe("9.800");
    expect(formatCount(35)).toBe("35");
    expect(formatCount(1234567)).toBe("1.234.567");
  });
  it("variaciones con signo, sin cambio y sin base", () => {
    expect(formatPct(11.4)).toBe("+11 %");
    expect(formatPct(-4.6)).toBe("−5 %");
    expect(formatPct(0.2)).toBe("sin cambio");
    expect(formatPct(null)).toBe("nuevo");
    expect(formatPoints(5)).toBe("+5");
    expect(formatPoints(-2)).toBe("−2");
    expect(formatPoints(0)).toBe("sin cambio");
  });
  it("el saludo nombra a una, dos o tres personas y al equipo si son más", () => {
    expect(greeting(["Ana"], "X")).toBe("Hola Ana,");
    expect(greeting(["Ana", "Luis"], "X")).toBe("Hola Ana y Luis,");
    expect(greeting(["Ana", "Luis", "María"], "X")).toBe("Hola Ana, Luis y María,");
    expect(greeting(["A", "B", "C", "D"], "Café Aurora")).toBe("Hola equipo de Café Aurora,");
    expect(greeting([], "Café Aurora")).toBe("Hola equipo de Café Aurora,");
  });
});

describe("bienvenida", () => {
  const input = { kind: "sitio" as const, techLabel: "WordPress", includesServer: true, eolNote: "PHP 8.2 deja de recibir parches el 31 de diciembre de 2026.", pin: "123456" };

  it("habla de «ustedes» con varias personas y de «tú» con una", () => {
    const team = buildWelcomeEmail({ ...base, ...input });
    expect(team.text).toContain("Hola Ana, Luis y María,");
    expect(team.text).toContain("No tienen que hacer nada");
    expect(team.subject).toBe("Su sitio ahora tiene seguimiento técnico permanente");
    const solo = buildWelcomeEmail({ ...one, ...input });
    expect(solo.text).toContain("Hola Ana,");
    expect(solo.text).toContain("No tienes que hacer nada");
    expect(solo.subject).toBe("Tu sitio ahora tiene seguimiento técnico permanente");
  });
  it("lleva el PIN, el portal y la firma de zipnegocios, no la de PageSpeed", () => {
    const m = buildWelcomeEmail({ ...base, ...input });
    expect(m.text).toContain("PIN: 123456");
    expect(m.html).toContain("https://app.example.com/c/cafe-aurora");
    expect(m.html).toContain("zipnegocios");
    expect(m.html).not.toContain("PAGESPEED");
    expect(m.text).toContain("Gustavo Amarista · zipnegocios");
  });
  it("sin servidor en el plan no promete servidor; sin nota de versiones omite ese dato", () => {
    const m = buildWelcomeEmail({ ...base, ...input, includesServer: false, eolNote: null, kind: "tienda", techLabel: "Shopify" });
    expect(m.text).not.toContain("Servidor, servicios y APIs");
    expect(m.text).not.toContain("Las versiones caducan");
    expect(m.text).not.toContain("endoflife");
    expect(m.text).toContain("tienda hecha en Shopify");
    const wp = buildWelcomeEmail({ ...base, ...input });
    expect(wp.text).toContain("Servidor, servicios y APIs");
    expect(wp.text).toContain("Las versiones caducan");
  });
  it("escapa el HTML de los datos que vienen de fuera", () => {
    const m = buildWelcomeEmail({ ...base, ...input, site: "<b>x</b>.com" });
    expect(m.html).not.toContain("<b>x</b>.com");
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;.com");
  });
});

describe("mensual", () => {
  it("el asunto dice «en orden» solo si el mes fue tranquilo", () => {
    expect(buildMonthlyEmail(monthly).subject).toBe("cafeaurora.com: octubre en orden. Rendimiento móvil 78 (+5)");
    expect(buildMonthlyEmail({ ...monthly, tone: "attention" }).subject).toBe("cafeaurora.com: resumen de octubre. Rendimiento móvil 78 (+5)");
  });
  it("sin actuaciones dice que no hizo falta intervenir", () => {
    expect(buildMonthlyEmail(monthly).text).toContain("Este mes no hizo falta intervenir");
  });
  it("la línea del servidor solo sale si el administrador la confirmó", () => {
    expect(buildMonthlyEmail(monthly).text).not.toContain("Servidor y servicios");
    expect(buildMonthlyEmail({ ...monthly, serverConfirmed: true }).text).toContain("Servidor y servicios: supervisados");
  });
  it("muestra la palabra de cada puntuación junto al número", () => {
    const html = buildMonthlyEmail(monthly).html;
    expect(html).toContain("Mejorable");
    expect(html).toContain("Bueno");
  });
});

describe("semanal", () => {
  it("asunto con visitas con punto de miles y variación", () => {
    expect(buildWeeklyEmail(weekly).subject).toBe("Su semana en la web: 1.240 visitas (+8 %) · 2 al 8 de nov");
    expect(buildWeeklyEmail({ ...weekly, names: ["Ana"] }).subject).toBe("Tu semana en la web: 1.240 visitas (+8 %) · 2 al 8 de nov");
  });
  it("una fuente sin semana anterior sale como «nuevo»", () => {
    expect(buildWeeklyEmail(weekly).text).toContain("TikTok: 40 (nuevo)");
  });
  it("con muy pocas visitas no muestra porcentajes", () => {
    const m = buildWeeklyEmail({ ...weekly, visits: 12 });
    expect(m.subject).toBe("Su semana en la web: 12 visitas · 2 al 8 de nov");
    expect(m.text).not.toContain("%");
  });
  it("dice hasta qué día llegan los datos", () => {
    expect(buildWeeklyEmail(weekly).text).toContain("Datos hasta el 8 de nov");
  });
});

describe("informe enviado a mano", () => {
  it("usa la voz del equipo o la de una persona según los destinatarios", () => {
    const m = buildClientReportEmail({ ...base, periodLabel: "últimos 30 días", summaryLine: "Todo bien." });
    expect(m.subject).toBe("Informe de cafeaurora.com · últimos 30 días");
    expect(m.text).toContain("Les adjunto el informe");
    expect(buildClientReportEmail({ ...one, periodLabel: "últimos 30 días", summaryLine: "Todo bien." }).text).toContain("Te adjunto el informe");
  });
});
