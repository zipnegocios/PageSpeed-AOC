import { describe, expect, it } from "vitest";
import { DEFAULT_SENDER, type ClientSender } from "@/server/domain/client-sender";
import {
  buildClientReportEmail,
  buildMonthlyEmail,
  buildWeeklyEmail,
  buildWelcomeEmail,
  welcomeOpening,
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
  portalUrl: "https://app.example.com/c/cafe-aurora",
  sender: DEFAULT_SENDER,
  appUrl: "https://app.example.com",
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
  search: { clicks: 310, clicksDeltaPct: 12, impressions: 9800 },
  sources: [
    { label: "Google (búsqueda)", visits: 610, deltaPct: 11 },
    { label: "TikTok", visits: 40, deltaPct: null },
  ],
  ai: { visits: 30, deltaPct: null },
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
  const wp = { site: "cafeaurora.com", solutions: ["sitio web"], techs: ["WordPress"], services: ["web", "seo", "server", "security"] };
  const input = { products: [wp], eolNote: "PHP 8.2 deja de recibir parches el 31 de diciembre de 2026.", pin: "123456" };

  it("habla de «ustedes» con varias personas y de «tú» con una, y de «activos digitales», no de «sitio»", () => {
    const team = buildWelcomeEmail({ ...base, ...input });
    expect(team.text).toContain("Hola Ana, Luis y María,");
    expect(team.text).toContain("No tienen que hacer nada");
    expect(team.subject).toBe("Sus activos digitales ahora tienen acompañamiento técnico de punta a punta");
    const solo = buildWelcomeEmail({ ...one, ...input });
    expect(solo.text).toContain("Hola Ana,");
    expect(solo.text).toContain("No tienes que hacer nada");
    expect(solo.subject).toBe("Tus activos digitales ahora tienen acompañamiento técnico de punta a punta");
    for (const m of [team, solo]) {
      expect(m.subject).not.toMatch(/sitio/i);
      expect(m.text).not.toContain("quien se encarga de su sitio");
      expect(m.text).not.toContain("Es el mismo seguimiento para cualquier tecnología");
    }
  });
  it("lleva el PIN, el portal y la firma con tu nombre primero, no la de PageSpeed", () => {
    const m = buildWelcomeEmail({ ...base, ...input });
    expect(m.text).toContain("PIN: 123456");
    expect(m.html).toContain("https://app.example.com/c/cafe-aurora");
    expect(m.html).toContain("zipnegocios");
    expect(m.html.replace(/alt="PageSpeed"/g, "")).not.toMatch(/pagespeed/i);
    // La banda lleva el logo y, junto a él, tu nombre; la marca va después.
    expect(m.html).toContain("https://app.example.com/brand/logo-glyph-email.png");
    expect(m.html.indexOf("<img")).toBeLessThan(m.html.indexOf("Gustavo Amarista"));
    expect(m.html.indexOf("Gustavo Amarista")).toBeLessThan(m.html.indexOf("zipnegocios"));
    expect(m.text).toContain("Gustavo Amarista\nzipnegocios");
    expect(m.text).toContain("WhatsApp +1 316 469 5701");
  });
  it("se presenta: el cliente no conoce esta dirección y reconoce a la persona", () => {
    const team = buildWelcomeEmail({ ...base, ...input });
    expect(team.text).toContain("Soy Gustavo Amarista (zipnegocios), quien se encarga de sus activos digitales. Les escribo desde esta dirección nueva");
    expect(team.text).toContain("si no la reconocen, es normal, soy yo");
    const solo = buildWelcomeEmail({ ...one, ...input });
    expect(solo.text).toContain("quien se encarga de tus activos digitales. Te escribo desde esta dirección nueva");
    expect(solo.text).toContain("si no la reconoces, es normal, soy yo");
  });
  it("lo general va arriba y lo específico en la lista de productos: qué es cada uno y en qué está hecho", () => {
    const m = buildWelcomeEmail({
      ...base,
      products: [wp, { site: "app.cafeaurora.com", solutions: ["aplicación móvil iOS", "chatbot"], techs: ["Swift (iOS)", "Firebase"], services: ["server", "security"] }],
      eolNote: null,
      pin: "123456",
    });
    expect(m.text).toContain("Desde hoy sus activos digitales tienen un acompañamiento técnico de punta a punta:");
    expect(m.text).toContain("- cafeaurora.com · sitio web en WordPress");
    expect(m.text).toContain("- app.cafeaurora.com · aplicación móvil iOS y chatbot en Swift (iOS) y Firebase");
    expect(m.text).toContain("Con mi equipo revisamos cada aspecto de cada uno");
  });
  it("lo que cubre y lo que se promete depende de los servicios marcados", () => {
    const only = (services: string[]) => buildWelcomeEmail({ ...base, products: [{ ...wp, services }], eolNote: null, pin: "123456" }).text;
    const web = only(["web"]);
    expect(web).toContain("Velocidad y calidad de cada página");
    expect(web).not.toContain("Servidor, servicios y APIs");
    expect(web).not.toContain("Dependencias e integraciones");
    expect(web).not.toContain("Cada lunes");
    expect(web).toContain("**Un correo al mes**".replace(/\*/g, ""));
    const infra = only(["server", "deps", "domain", "security"]);
    for (const t of ["Servidor, servicios y APIs", "Dependencias e integraciones", "Dominio, DNS y certificados", "Seguridad y actualizaciones"]) expect(infra).toContain(t);
    expect(infra).not.toContain("Velocidad y calidad de cada página");
    expect(only(["seo"])).toContain("Cada lunes");
    expect(only(["seo"])).toContain("Un correo por semana y uno al mes");
  });
  it("el recuadro «Si ves números bajos, no te alarmes»: visible, antes de la tabla, con las tres etapas y repetido junto al PIN", () => {
    const m = buildWelcomeEmail({ ...base, ...input });
    expect(m.text).toContain("SI VES NÚMEROS BAJOS, NO TE ALARMES");
    expect(m.text).toContain("punto de partida");
    expect(m.text).toMatch(/1\. Hoy:[\s\S]*2\. Las próximas semanas: voy corrigiendo de forma progresiva[\s\S]*3\. Cada mes:/);
    expect(m.text).toContain("si sus valores ya están bien, perfecto".replace("si", "Y si"));
    expect(m.text.indexOf("SI VES NÚMEROS BAJOS")).toBeLessThan(m.text.indexOf("Esto es lo que van a recibir"));
    expect(m.text).toContain("Recuerda: si en el portal ven valores por debajo de la meta");
    expect(m.html).toContain("Si ves números bajos, no te alarmes");
    const solo = buildWelcomeEmail({ ...one, ...input });
    expect(solo.text).toContain("Y si tus valores ya están bien, perfecto: sigue tranquilo");
  });
  it("«Por qué esto importa»: cuatro ideas, con las capas y la observabilidad; PHP solo como ejemplo", () => {
    const m = buildWelcomeEmail({ ...base, ...input });
    for (const t of ["La velocidad se nota en el negocio", "Las vulnerabilidades son la puerta de entrada más común", "Todo lo que sostiene un activo digital caduca", "Por eso hace falta observabilidad en todas las capas", "librerías y dependencias", "dominios, certificados y enrutamiento", "OWASP", "sostiene este acompañamiento mensual"]) expect(m.text).toContain(t);
    expect(m.text).toContain("(por ejemplo, PHP 8.2 deja de recibir parches el 31 de diciembre de 2026)");
    expect(m.text).toContain("endoflife.date");
    const generic = buildWelcomeEmail({ ...base, ...input, eolNote: null });
    expect(generic.text).toContain("Todo lo que sostiene un activo digital caduca");
    expect(generic.text).not.toContain("por ejemplo");
    expect(generic.text).not.toContain("endoflife");
    expect(m.text).not.toContain("vigilancia");
  });
  it("escapa el HTML de los datos que vienen de fuera", () => {
    const m = buildWelcomeEmail({ ...base, ...input, products: [{ ...wp, site: "<b>x</b>.com", solutions: ["<i>tienda</i>"] }] });
    expect(m.html).not.toContain("<b>x</b>.com");
    expect(m.html).not.toContain("<i>tienda</i>");
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;.com");
  });
  it("la apertura se puede pedir sola (la vista previa del formulario)", () => {
    const blocks = welcomeOpening({ names: ["Ana"], products: [wp], sender: DEFAULT_SENDER });
    expect(blocks.map((b) => b.k)).toEqual(["p", "p", "list", "p", "p"]);
  });
});

describe("quién firma: el responsable del cliente", () => {
  const luis: ClientSender = { ...DEFAULT_SENDER, name: "Luis Porteles", whatsapp: "+1 555 010 0000", email: "luis@example.com" };
  const input = { products: [{ site: "cafeaurora.com", solutions: ["sitio web"], techs: ["WordPress"], services: ["web", "seo", "server", "security"] }], eolNote: null, pin: "123456" };

  it("la bienvenida, la banda, la firma y el pie llevan el nombre y el WhatsApp de Luis, y nada de Gustavo", () => {
    const m = buildWelcomeEmail({ ...base, ...input, sender: luis });
    for (const out of [m.html, m.text]) {
      expect(out).toContain("Luis Porteles");
      expect(out).toContain("+1 555 010 0000");
      expect(out).not.toContain("Gustavo");
      expect(out).not.toContain("316 469");
    }
    expect(m.text).toContain("Soy Luis Porteles (zipnegocios), quien se encarga de sus activos digitales.");
    expect(m.html.indexOf("<img")).toBeLessThan(m.html.indexOf("Luis Porteles"));
  });
  it("los demás correos también: semanal, mensual e informe a mano", () => {
    for (const m of [buildWeeklyEmail({ ...weekly, sender: luis }), buildMonthlyEmail({ ...monthly, sender: luis }), buildClientReportEmail({ ...base, sender: luis, periodLabel: "últimos 30 días", summaryLine: "Todo bien." })]) {
      expect(m.text).toContain("Luis Porteles\nzipnegocios");
      expect(m.text).toContain("WhatsApp +1 555 010 0000");
      expect(m.html).not.toContain("Gustavo");
    }
  });
  it("sin teléfono guardado, el pie no muestra WhatsApp en lugar de inventarlo", () => {
    const m = buildWelcomeEmail({ ...base, ...input, sender: { ...luis, whatsapp: null } });
    // «WhatsApp» como red social de origen de las visitas sí puede salir; lo que no puede salir es un contacto por WhatsApp.
    for (const out of [m.text, m.html]) expect(out).not.toMatch(/WhatsApp\s*\+|por WhatsApp|wa\.me/i);
  });
  it("el nombre del responsable se escapa", () => {
    const m = buildWelcomeEmail({ ...base, ...input, sender: { ...luis, name: "Luis <b>x</b>" } });
    expect(m.html).not.toContain("Luis <b>x</b>");
    expect(m.html).toContain("Luis &lt;b&gt;x&lt;/b&gt;");
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
  it("sin mes anterior no inventa una comparación", () => {
    const m = buildMonthlyEmail({ ...monthly, scores: [{ label: "Rendimiento", mobile: 78, desktop: 91, mobileDelta: null, desktopDelta: null }] });
    expect(m.subject).toBe("cafeaurora.com: octubre en orden. Rendimiento móvil 78");
    expect(m.text).toContain("sin comparación");
  });
  it("la línea del servidor solo sale si el administrador la confirmó", () => {
    expect(buildMonthlyEmail(monthly).text).not.toContain("Servidor y servicios");
    expect(buildMonthlyEmail({ ...monthly, serverConfirmed: true }).text).toContain("Servidor y servicios: supervisados");
  });
  it("en mejora inicial el estado del mes es sereno: punto de partida, sin «puntos en revisión» ni «en orden»", () => {
    const m = buildMonthlyEmail({ ...monthly, tone: "attention", statusLine: "Hay 3 puntos en revisión; los explico en el portal.", initialImprovement: true });
    expect(m.text).toContain("SEGUIMOS EN LA FASE DE MEJORA INICIAL");
    expect(m.text).toContain("punto de partida");
    expect(m.text).not.toContain("puntos en revisión");
    expect(m.text).not.toContain("Estado del mes:");
    expect(m.subject).toBe("cafeaurora.com: resumen de octubre. Rendimiento móvil 78 (+5)");
    expect(buildMonthlyEmail({ ...monthly, initialImprovement: true }).subject).toContain("resumen de octubre");
    expect(buildMonthlyEmail({ ...monthly, initialImprovement: false }).text).toContain("Estado del mes:");
  });
  it("muestra la palabra de cada puntuación junto al número", () => {
    const html = buildMonthlyEmail(monthly).html;
    expect(html).toContain("Mejorable");
    expect(html).toContain("Bueno");
  });
});

describe("bienvenida: qué se mide", () => {
  it("nombra todo lo que se mide: velocidad, experiencia real, visitas y redes por nombre, Google y salud SEO, y los dos PDF", () => {
    const m = buildWelcomeEmail({ ...base, products: [{ site: "cafeaurora.com", solutions: ["sitio web"], techs: ["WordPress"], services: ["web", "seo", "security"] }], eolNote: null, pin: "123456" });
    for (const t of ["Velocidad y calidad de cada página", "Experiencia real", "Instagram, WhatsApp, Facebook, TikTok, LinkedIn", "visibilidad en Google", "Salud SEO", "dos informes en PDF"]) expect(m.text).toContain(t);
  });
});

describe("semanal", () => {
  it("con consultas de búsqueda nombra con qué palabras buscaron; y explica «Directo o sin identificar»", () => {
    const m = buildWeeklyEmail({ ...weekly, queries: [{ query: "grúas torre", clicks: 21 }], sources: [...weekly.sources, { label: "Directo o sin identificar", visits: 300, deltaPct: 2 }] });
    expect(m.text).toContain("«grúas torre» (21 clics)");
    expect(m.text).toContain("mensajes privados");
    expect(buildWeeklyEmail(weekly).text).not.toContain("mensajes privados");
  });
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
  it("las visitas de IA van aparte, como mínimo observado, y no entran en las barras", () => {
    const m = buildWeeklyEmail(weekly);
    expect(m.text).toContain("asistentes de IA");
    expect(m.text).toContain("ya incluidas arriba");
    expect(buildWeeklyEmail({ ...weekly, ai: null }).text).not.toContain("asistentes de IA");
  });
  it("si la semana anterior no tuvo clics, no pone «nuevo» junto a los clics", () => {
    const m = buildWeeklyEmail({ ...weekly, search: { clicks: 310, clicksDeltaPct: null, impressions: 9800 } });
    expect(m.text).toContain("Clics desde Google: 310 ·");
    expect(m.text).not.toContain("310 (nuevo)");
  });
  it("sin datos de Search Console no muestra la línea de clics", () => {
    expect(buildWeeklyEmail(weekly).text).toContain("Clics desde Google: 310");
    expect(buildWeeklyEmail({ ...weekly, search: null }).text).not.toContain("Clics desde Google");
  });
  it("dice hasta qué día llegan los datos", () => {
    expect(buildWeeklyEmail(weekly).text).toContain("Datos hasta el 8 de nov");
  });
});

describe("informe enviado a mano", () => {
  it("usa la voz del equipo o la de una persona según los destinatarios", () => {
    const m = buildClientReportEmail({ ...base, periodLabel: "últimos 30 días", summaryLine: "Todo bien." });
    expect(m.subject).toBe("Informes técnicos web · cafeaurora.com · últimos 30 días");
    expect(m.text).toContain("Les adjunto los dos informes");
    expect(buildClientReportEmail({ ...one, periodLabel: "últimos 30 días", summaryLine: "Todo bien." }).text).toContain("Te adjunto los dos informes");
  });
  it("nombra los dos informes con los apartados reales del índice y las cifras clave", () => {
    const m = buildClientReportEmail({ ...base, periodLabel: "últimos 30 días", summaryLine: "Todo bien.", facts: ["**Visitas:** 9.394 (+4 %)."] });
    expect(m.text).toContain("Informe resumen (7 apartados");
    expect(m.text).toContain("Informe de ingeniería (11 apartados");
    for (const t of ["experiencia real de los visitantes", "búsqueda en google", "search console en detalle", "visitas y de dónde llegan"]) expect(m.text.toLowerCase()).toContain(t);
    expect(m.text).toContain("Visitas: 9.394 (+4 %).");
  });
});
