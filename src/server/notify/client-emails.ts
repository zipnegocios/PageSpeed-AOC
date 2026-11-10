import { SUPPORT_CONTACT } from "@/lib/contact";
import { lightToken } from "@/lib/tokens";
import { scoreBand } from "@/server/domain/score-band";
import { EMAIL, emailButton } from "./email-theme";

/**
 * Correos del servicio de seguimiento técnico al cliente (bienvenida, estado mensual, semana en la web e informe
 * enviado a mano). Funciones puras: reciben los datos ya calculados y devuelven asunto, texto y HTML.
 *
 * Voz: primera persona del singular, firmados por «zipnegocios». Con una sola persona hablan de «tú»; con varias,
 * de «ustedes», y el saludo nombra a todas. Los textos no dependen de la tecnología del cliente.
 */

export const SENDER_BRAND = "zipnegocios";
export const SERVICE_NAME = "Informes técnicos web";

export type ClientEmail = { subject: string; text: string; html: string };

export type ClientEmailBase = {
  /** Nombres de las personas a las que se dirige el correo (el principal primero). */
  names: string[];
  /** Nombre del cliente: se usa en el saludo cuando son cuatro personas o más. */
  clientName: string;
  /** Sitio o dominio que se muestra, por ejemplo «cafeaurora.com». */
  site: string;
  /** Dirección de la app: de ahí sale el logo del correo. */
  appUrl: string;
  portalUrl: string;
};

export type ProjectKind = "sitio" | "tienda" | "aplicación";

// ------------------------------------------------------------------ utilidades

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Texto con **negrita** y saltos de línea, ya escapado. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

/** Miles con punto, sin depender del idioma del servidor (es no agrupa los números de cuatro cifras). */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Variación porcentual: «+11 %», «−5 %», «sin cambio»; null si no hay base de comparación. */
export function formatPct(pct: number | null): string {
  if (pct === null) return "nuevo";
  const r = Math.round(pct);
  if (r === 0) return "sin cambio";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)} %`;
}

/** Variación en puntos: «+5», «−2», «sin cambio». */
export function formatPoints(diff: number): string {
  if (diff === 0) return "sin cambio";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
}

/** Saludo según cuántas personas son: una, hasta tres por nombre, más de tres al equipo. */
export function greeting(names: string[], clientName: string): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0 || list.length > 3) return `Hola equipo de ${clientName},`;
  if (list.length === 1) return `Hola ${list[0]},`;
  return `Hola ${list.slice(0, -1).join(", ")} y ${list[list.length - 1]},`;
}

/** Elige la forma en singular o plural según haya una o varias personas. */
const voice = (names: string[]) => (singular: string, plural: string) => (names.filter((n) => n.trim()).length > 1 ? plural : singular);

const C = {
  ok: lightToken("ok"),
  okBg: lightToken("ok-subtle"),
  okInk: lightToken("on-ok-subtle"),
  warnBg: "#FEF3C7",
  warnInk: "#92400E",
  line: lightToken("border"),
  soft: lightToken("surface-100"),
  track: lightToken("surface-300"),
};

// ----------------------------------------------------------------- bloques

type Block =
  | { k: "p"; t: string }
  | { k: "h"; t: string }
  | { k: "fine"; t: string }
  | { k: "list"; items: string[] }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "status"; label: string; t: string }
  | { k: "buttons"; items: Array<{ label: string; url: string; alt?: boolean }> }
  | { k: "pin"; pin: string }
  | { k: "big"; value: string; caption: string }
  | { k: "bars"; rows: Array<{ label: string; value: number; delta: string; up: boolean }> }
  | { k: "log"; rows: Array<{ date: string; t: string }> }
  | { k: "ranked"; rows: Array<{ label: string; value: number }> }
  | { k: "scores"; rows: Array<{ label: string; mobile: number; desktop: number; mobileDelta: number; desktopDelta: number }> };

const TD = `padding:8px 8px;border-bottom:1px solid ${C.line};vertical-align:top;font-size:14px`;

function scoreCell(score: number, diff: number): string {
  const band = scoreBand(score);
  const [bg, fg] = band.tone === "ok" ? [C.okBg, C.okInk] : band.tone === "warning" ? [C.warnBg, C.warnInk] : ["#FEE2E2", "#7F1D1D"];
  const word = band.word[0]!.toUpperCase() + band.word.slice(1);
  const dc = diff > 0 ? `color:${C.ok};font-weight:bold` : `color:${EMAIL.muted}`;
  return (
    `<span style="display:inline-block;min-width:34px;text-align:center;font-weight:bold;padding:1px 6px;background:${bg};color:${fg}">${score}</span>` +
    `<br><span style="font-size:12px;color:${EMAIL.muted}">${word}</span><br><span style="font-size:12px;${dc}">${esc(formatPoints(diff))}</span>`
  );
}

function blockHtml(b: Block): string {
  switch (b.k) {
    case "p":
      return `<p style="margin:0 0 14px">${inline(b.t)}</p>`;
    case "fine":
      return `<p style="margin:0 0 14px;color:${EMAIL.muted};font-size:12px">${inline(b.t)}</p>`;
    case "h":
      return `<p style="margin:22px 0 8px;font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase">${esc(b.t)}</p>`;
    case "list":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px">` +
        b.items.map((i) => `<tr><td valign="top" style="padding:4px 10px 4px 0;color:${C.ok};font-size:10px;line-height:20px">&#9632;</td><td style="padding:4px 0">${inline(i)}</td></tr>`).join("") +
        `</table>`
      );
    case "table":
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px"><tr>` +
        b.head.map((h) => `<td style="${TD};font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:${EMAIL.muted};font-weight:bold">${esc(h)}</td>`).join("") +
        `</tr>` +
        b.rows.map((r) => `<tr>${r.map((c) => `<td style="${TD}">${inline(c)}</td>`).join("")}</tr>`).join("") +
        `</table>`
      );
    case "status":
      return `<div style="background:${C.okBg};color:${C.okInk};border-left:4px solid ${C.ok};padding:12px 14px;margin:0 0 16px"><div style="font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">${esc(b.label)}</div>${inline(b.t)}</div>`;
    case "buttons":
      return (
        `<p style="margin:18px 0">` +
        b.items
          .map((i) =>
            i.alt
              ? `<a href="${esc(i.url)}" style="display:inline-block;border:1px solid ${EMAIL.navy};color:${EMAIL.navy};padding:9px 15px;border-radius:2px;text-decoration:none;font-weight:bold;margin:0 10px 8px 0">${esc(i.label)}</a>`
              : `<span style="display:inline-block;margin:0 10px 8px 0">${emailButton(esc(i.url), esc(i.label))}</span>`,
          )
          .join("") +
        `</p>`
      );
    case "pin":
      return `<p style="margin:4px 0 14px"><span style="display:inline-block;font-family:'Courier New',monospace;font-weight:bold;font-size:28px;letter-spacing:.3em;background:${C.soft};padding:8px 14px 8px 18px">${esc(b.pin)}</span></p>`;
    case "big":
      return `<p style="margin:0 0 6px"><span style="font-size:40px;line-height:1.1;font-weight:bold">${esc(b.value)}</span> <span style="font-size:14px;color:${EMAIL.muted}">${inline(b.caption)}</span></p>`;
    case "bars": {
      const max = Math.max(1, ...b.rows.map((r) => r.value));
      return b.rows
        .map((r) => {
          const w = Math.max(2, Math.round((r.value / max) * 100));
          const dc = r.up ? `color:${C.ok};font-weight:bold` : `color:${EMAIL.muted}`;
          return (
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>` +
            `<td style="font-size:14px">${esc(r.label)}</td>` +
            `<td align="right" style="font-size:14px;white-space:nowrap"><b>${formatCount(r.value)}</b> <span style="font-size:12px;margin-left:6px;${dc}">${esc(r.delta)}</span></td></tr>` +
            `<tr><td colspan="2" style="padding-top:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.track}"><tr>` +
            `<td width="${w}%" style="background:${C.ok};height:7px;line-height:7px;font-size:0">&nbsp;</td><td></td></tr></table></td></tr></table>`
          );
        })
        .join("");
    }
    case "log":
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px">` +
        b.rows.map((r) => `<tr><td width="56" style="${TD};color:${EMAIL.muted};font-weight:bold;font-size:13px">${esc(r.date)}</td><td style="${TD}">${inline(r.t)}</td></tr>`).join("") +
        `</table>`
      );
    case "ranked":
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">` +
        b.rows.map((r, i) => `<tr><td style="padding:3px 0;font-size:14px">${i + 1}. ${esc(r.label)}</td><td align="right" style="padding:3px 0;font-size:14px"><b>${formatCount(r.value)}</b></td></tr>`).join("") +
        `</table>`
      );
    case "scores":
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px"><tr>` +
        ["", "Móvil", "Escritorio"].map((h) => `<td style="${TD};font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:${EMAIL.muted};font-weight:bold">${h}</td>`).join("") +
        `</tr>` +
        b.rows.map((r) => `<tr><td style="${TD}">${esc(r.label)}</td><td style="${TD}">${scoreCell(r.mobile, r.mobileDelta)}</td><td style="${TD}">${scoreCell(r.desktop, r.desktopDelta)}</td></tr>`).join("") +
        `</table>`
      );
  }
}

function blockText(b: Block): string[] {
  switch (b.k) {
    case "p":
    case "fine":
      return [plain(b.t), ""];
    case "h":
      return [b.t.toUpperCase()];
    case "list":
      return [...b.items.map((i) => `- ${plain(i)}`), ""];
    case "table":
      return [...b.rows.map((r) => r.map((c) => plain(c).replace(/\n/g, " ")).join(" · ")), ""];
    case "status":
      return [`${b.label}: ${plain(b.t)}`, ""];
    case "buttons":
      return [...b.items.map((i) => `${i.label}: ${i.url}`), ""];
    case "pin":
      return [`PIN: ${b.pin}`, ""];
    case "big":
      return [`${b.value} ${plain(b.caption)}`, ""];
    case "bars":
      return [...b.rows.map((r) => `${r.label}: ${formatCount(r.value)} (${r.delta})`), ""];
    case "log":
      return [...b.rows.map((r) => `${r.date}: ${plain(r.t)}`), ""];
    case "ranked":
      return [...b.rows.map((r, i) => `${i + 1}. ${r.label}: ${formatCount(r.value)}`), ""];
    case "scores":
      return [...b.rows.map((r) => `${r.label}: móvil ${r.mobile} (${formatPoints(r.mobileDelta)}), escritorio ${r.desktop} (${formatPoints(r.desktopDelta)})`), ""];
  }
}

function band(appUrl: string): string {
  let origin = "";
  try {
    origin = new URL(appUrl).origin;
  } catch {
    /* sin logo: queda el nombre */
  }
  const img = origin ? `<img src="${origin}/brand/logo-glyph-email.png" width="20" height="29" alt="" style="vertical-align:middle;border:0;margin-right:10px">` : "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.navy};border-left:4px solid ${EMAIL.lime}"><tr>` +
    `<td style="padding:12px 16px">${img}<span style="font-size:14px;letter-spacing:.1em;font-weight:bold;color:${EMAIL.lime};vertical-align:middle">${SENDER_BRAND}</span></td>` +
    `<td align="right" style="padding:12px 16px;font-size:12px;color:#9CA3AF">${SERVICE_NAME}</td></tr></table>`
  );
}

function compose(input: { subject: string; preview: string; base: ClientEmailBase; blocks: Block[]; footerNote?: string }): ClientEmail {
  const hello = greeting(input.base.names, input.base.clientName);
  const contact = `${SENDER_BRAND} · ${SUPPORT_CONTACT.name} · WhatsApp ${SUPPORT_CONTACT.whatsapp}`;
  const html =
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(input.preview)}</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${EMAIL.ink};max-width:600px;background:#FFFFFF">` +
    band(input.base.appUrl) +
    `<div style="padding:20px;border:1px solid ${C.line};border-top:0">` +
    `<p style="margin:0 0 14px">${esc(hello)}</p>` +
    input.blocks.map(blockHtml).join("") +
    `<p style="margin:0 0 14px">${SUPPORT_CONTACT.name} · ${SENDER_BRAND}</p>` +
    `<div style="border-top:1px solid ${C.line};margin-top:22px;padding-top:12px;color:${EMAIL.muted};font-size:12px">` +
    (input.footerNote ? `<p style="margin:0 0 4px">${esc(input.footerNote)}</p>` : "") +
    `<p style="margin:0">${esc(contact)}</p></div></div></div>`;
  const text = [hello, "", ...input.blocks.flatMap(blockText), `${SUPPORT_CONTACT.name} · ${SENDER_BRAND}`, "", ...(input.footerNote ? [input.footerNote] : []), contact].join("\n");
  return { subject: input.subject, text, html };
}

const kindForms = (kind: ProjectKind) => (kind === "sitio" ? { made: "hecho", fast: "rápido" } : { made: "hecha", fast: "rápida" });

// ---------------------------------------------------------------- bienvenida

/** Datos citados en «Por qué esto importa». Ver docs/borradores-correos.md (sección Fuentes). Revisar las fechas cada trimestre. */
export const WHY_SPEED =
  "**La velocidad se nota en el negocio.** Un estudio de Deloitte y 55, encargado por Google, con 37 marcas y más de 30 millones de sesiones, asoció una mejora de 0,1 segundos en la velocidad móvil con un 9,2 % más de gasto en tiendas online y un 21,6 % más de visitantes que llegan al formulario en sitios que captan clientes.";
export const WHY_VULNERABILITIES =
  "**Las vulnerabilidades son la puerta de entrada más común.** Según el informe de Verizon de 2026, el 31 % de las brechas de seguridad empieza con una vulnerabilidad de software, por encima de las contraseñas robadas.";
/** `eolNote` es la frase de fin de soporte de la tecnología del cliente (PHP, Node.js…), o null si no aplica. */
export const whyVersions = (eolNote: string) => `**Las versiones caducan.** ${eolNote} Mantener al día lo que corre debajo de un sitio es un trabajo continuo, no de una vez.`;

export type WelcomeInput = ClientEmailBase & {
  kind: ProjectKind;
  /** Tecnología que se muestra: «WordPress», «Shopify», «Next.js»… */
  techLabel: string;
  /** Si el plan incluye la supervisión de servidor, servicios y APIs. */
  includesServer: boolean;
  eolNote: string | null;
  pin: string;
};

export function buildWelcomeEmail(i: WelcomeInput): ClientEmail {
  const T = voice(i.names);
  const f = kindForms(i.kind);
  const blocks: Block[] = [
    {
      k: "p",
      t: `Desde ahora **${i.site}**, ${i.kind} ${f.made} en **${i.techLabel}**, cuenta con un seguimiento técnico permanente. Lo he incorporado a mi trabajo ${T("contigo", "con ustedes")} para que ${T("tu", "su")} ${i.kind} se mantenga ${f.fast}, visible y al día, y para enterarme antes que ${T("tus", "sus")} visitantes de cualquier cosa que falle.`,
    },
    { k: "p", t: "Es el mismo seguimiento para cualquier tecnología: un CMS, una tienda online o una aplicación a medida." },
    {
      k: "p",
      t: `**${T("No tienes que hacer nada", "No tienen que hacer nada")}.** Si algo cambia en Google Analytics, se cae, o una página o producto nuevo necesita ajustes, yo me encargo. Esto es lo que ${T("vas a recibir", "van a recibir")}:`,
    },
    {
      k: "table",
      head: ["Cuándo", "Qué"],
      rows: [
        ["**Cada lunes**", `**${T("Tu", "Su")} semana en la web**\nCuántas visitas ${T("tuviste", "tuvieron")}, de dónde llegaron (Google, Instagram, LinkedIn…) y qué páginas funcionaron.`],
        ["**Una vez al mes**", "**Estado general**\nVelocidad y visibilidad, lo que atendimos y lo que sigue."],
        ["**Solo si hace falta**", `**Aviso de incidencia**\n${T("Te escribo", "Les escribo")} yo cuando algo ya está atendido, o necesito algo de ${T("ti", "ustedes")}.`],
      ],
    },
    { k: "p", t: "En total, **no más de cinco correos al mes**, salvo que haya una incidencia." },
    { k: "h", t: "Qué cuidamos" },
    {
      k: "list",
      items: [
        "**Velocidad y rendimiento:** medido automáticamente en móvil y escritorio.",
        "**Visibilidad en buscadores y tráfico:** medido automáticamente.",
        ...(i.includesServer ? ["**Servidor, servicios y APIs:** yo los superviso de forma continua."] : []),
        "**Seguridad y actualizaciones:** yo las superviso y las aplico.",
      ],
    },
    {
      k: "p",
      t: T(
        "Cuando quieras mirar tú mismo, tienes tu portal, siempre actualizado:",
        "Cuando quieran mirar ustedes mismos, tienen su portal, siempre actualizado. Es un solo acceso para todo el equipo:",
      ),
    },
    { k: "pin", pin: i.pin },
    { k: "buttons", items: [{ label: "Abrir el portal", url: i.portalUrl }] },
    { k: "fine", t: T("Lo puedes instalar como app en el móvil.", "Lo pueden instalar como app en el móvil. Si alguien cambia el PIN, les llega a todos.") },
    { k: "h", t: "Por qué esto importa" },
    { k: "list", items: [WHY_SPEED, WHY_VULNERABILITIES, ...(i.eolNote ? [whyVersions(i.eolNote)] : [])] },
    { k: "fine", t: `Fuentes: Deloitte y 55 para Google (web.dev), Verizon DBIR 2026${i.eolNote ? ", endoflife.date" : ""}.` },
    {
      k: "p",
      t: T(
        "Para cambiar la frecuencia de los correos o añadir a alguien más, respóndeme este correo o escríbeme por WhatsApp.",
        "Para cambiar la frecuencia de los correos o añadir a alguien más, respóndanme este correo o escríbanme por WhatsApp.",
      ),
    },
  ];
  return compose({
    subject: `${T("Tu", "Su")} ${i.kind} ahora tiene seguimiento técnico permanente`,
    preview: T("Qué vas a recibir, cuándo y cómo verlo cuando quieras. No tienes que hacer nada.", "Qué van a recibir, cuándo y cómo verlo cuando quieran. No tienen que hacer nada."),
    base: i,
    blocks,
  });
}

// -------------------------------------------------------------------- mensual

export type MonthlyInput = ClientEmailBase & {
  monthLabel: string;
  prevMonthLabel: string;
  /** «ok» si el mes fue tranquilo; «attention» si hay algo que explicar. Cambia el asunto. */
  tone: "ok" | "attention";
  /** Frase de estado elegida por reglas, nunca libre. */
  statusLine: string;
  /** Filas de «En números»: rendimiento primero. */
  scores: Array<{ label: string; mobile: number; desktop: number; mobileDelta: number; desktopDelta: number }>;
  /** Solo true si el plan incluye servidor y el administrador confirmó la revisión del mes. */
  serverConfirmed: boolean;
  actions: Array<{ date: string; text: string }>;
  upcoming: string | null;
  newPages: string | null;
  reportUrl: string | null;
};

export function buildMonthlyEmail(i: MonthlyInput): ClientEmail {
  const T = voice(i.names);
  const perf = i.scores[0];
  const blocks: Block[] = [
    { k: "p", t: `Este es el resumen de ${i.monthLabel} de **${i.site}**.` },
    { k: "status", label: "Estado del mes", t: i.statusLine },
    { k: "h", t: "En números" },
    { k: "fine", t: `Promedio del mes, frente a ${i.prevMonthLabel}` },
    { k: "scores", rows: i.scores },
    ...(i.serverConfirmed ? ([{ k: "p", t: "**Servidor y servicios:** supervisados durante todo el mes, sin incidencias." }] as Block[]) : []),
    { k: "h", t: "Lo que atendimos este mes" },
    i.actions.length > 0
      ? { k: "log", rows: i.actions.map((a) => ({ date: a.date, t: a.text })) }
      : { k: "p", t: "Este mes no hizo falta intervenir: todo se mantuvo estable." },
    ...(i.upcoming ? ([{ k: "h", t: "Lo que viene" }, { k: "p", t: i.upcoming }] as Block[]) : []),
    ...(i.newPages ? ([{ k: "h", t: "Páginas nuevas que detectamos" }, { k: "p", t: i.newPages }] as Block[]) : []),
    {
      k: "buttons",
      items: [{ label: "Ver el detalle en el portal", url: i.portalUrl }, ...(i.reportUrl ? [{ label: "Descargar el informe en PDF", url: i.reportUrl, alt: true }] : [])],
    },
    { k: "p", t: T("Cualquier cosa que quieras que revise, respóndeme este correo.", "Cualquier cosa que quieran que revise, respóndanme este correo.") },
  ];
  const head = perf ? ` Rendimiento móvil ${perf.mobile} (${formatPoints(perf.mobileDelta)})` : "";
  return compose({
    subject: i.tone === "ok" ? `${i.site}: ${i.monthLabel} en orden.${head}` : `${i.site}: resumen de ${i.monthLabel}.${head}`,
    preview: "Lo que revisamos, lo que atendimos y lo que viene.",
    base: i,
    blocks,
    footerNote: "Para cambiar la frecuencia, respóndeme este correo.",
  });
}

// --------------------------------------------------------------------- semanal

export type WeeklyInput = ClientEmailBase & {
  /** «2 al 8 de noviembre». */
  rangeLabel: string;
  /** «2 al 8 de nov», para el asunto. */
  rangeShort: string;
  visits: number;
  visitsDeltaPct: number | null;
  googleClicks: number;
  clicksDeltaPct: number | null;
  impressions: number;
  /** Orígenes ya agrupados y en orden; `deltaPct` null si no había visitas la semana anterior. */
  sources: Array<{ label: string; visits: number; deltaPct: number | null }>;
  topPages: Array<{ label: string; visits: number }>;
  /** Frase descriptiva por reglas; nunca atribuye causas. */
  summaryLine: string;
  /** Último día con datos, «8 de nov». */
  dataThrough: string;
};

/** Debajo de este número de visitas no se muestran porcentajes: sobre cifras tan pequeñas engañan. */
export const WEEKLY_QUIET_VISITS = 50;

export function buildWeeklyEmail(i: WeeklyInput): ClientEmail {
  const T = voice(i.names);
  const quiet = i.visits < WEEKLY_QUIET_VISITS;
  const pct = (p: number | null) => (quiet ? "" : formatPct(p));
  const caption = quiet ? "visitas esta semana" : i.visitsDeltaPct === null ? "visitas" : `visitas · **${formatPct(i.visitsDeltaPct)}** frente a la semana anterior`;
  const blocks: Block[] = [
    { k: "p", t: `Así fue la semana del **${i.rangeLabel}** en **${i.site}**.` },
    { k: "big", value: formatCount(i.visits), caption },
    {
      k: "p",
      t: `Clics desde Google: **${formatCount(i.googleClicks)}**${quiet ? "" : ` (${formatPct(i.clicksDeltaPct)})`} · Veces que ${T("apareciste", "aparecieron")}: **${formatCount(i.impressions)}**`,
    },
    { k: "h", t: "De dónde llegaron" },
    { k: "bars", rows: i.sources.map((s) => ({ label: s.label, value: s.visits, delta: pct(s.deltaPct), up: !quiet && (s.deltaPct === null || s.deltaPct > 0) })) },
    { k: "h", t: "Las 3 páginas más vistas" },
    { k: "ranked", rows: i.topPages.slice(0, 3).map((p) => ({ label: p.label, value: p.visits })) },
    { k: "status", label: "En una línea", t: i.summaryLine },
    { k: "buttons", items: [{ label: "Ver más en el portal", url: i.portalUrl }] },
  ];
  const delta = !quiet && i.visitsDeltaPct !== null ? ` (${formatPct(i.visitsDeltaPct)})` : "";
  return compose({
    subject: `${T("Tu", "Su")} semana en la web: ${formatCount(i.visits)} visitas${delta} · ${i.rangeShort}`,
    preview: "De dónde llegaron y qué páginas funcionaron.",
    base: i,
    blocks,
    footerNote: `Datos hasta el ${i.dataThrough}. Para cambiar la frecuencia, respóndeme este correo.`,
  });
}

// ---------------------------------------------------------------- informe manual

export type ManualReportInput = ClientEmailBase & {
  /** «últimos 30 días». */
  periodLabel: string;
  summaryLine: string;
};

/** Correo del botón «Enviar a …». El PDF lo adjunta quien envía. */
export function buildClientReportEmail(i: ManualReportInput): ClientEmail {
  const T = voice(i.names);
  const blocks: Block[] = [
    {
      k: "p",
      t: `${T("Te adjunto", "Les adjunto")} el informe de **${i.site}** de los ${i.periodLabel}: cómo está cada página en móvil y escritorio, qué mejoró y qué sigue en revisión.`,
    },
    { k: "status", label: "Lo más importante", t: i.summaryLine },
    { k: "p", t: `${T("Siempre puedes ver", "Siempre pueden ver")} el estado actualizado en ${T("tu", "su")} portal:` },
    { k: "buttons", items: [{ label: "Abrir el portal", url: i.portalUrl }] },
  ];
  return compose({ subject: `Informe de ${i.site} · ${i.periodLabel}`, preview: `Informe de ${i.site}, ${i.periodLabel}.`, base: i, blocks });
}
