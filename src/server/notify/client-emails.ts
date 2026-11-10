import { lightToken } from "@/lib/tokens";
import { ENGINEERING_SECTIONS, SUMMARY_SECTIONS } from "@/server/domain/report-outline";
import { scoreBand } from "@/server/domain/score-band";
import { DEFAULT_SENDER, SENDER_BRAND_NAME, SENDER_SERVICE_NAME, type ClientSender } from "@/server/domain/client-sender";
import { SERVICE_KEYS, unionServices, type ServiceKey } from "@/server/domain/client-welcome";
import { clientEmailBand, clientEmailFooter, clientTextSignature, EMAIL, emailButton } from "./email-theme";

/**
 * Correos del servicio de seguimiento técnico al cliente (bienvenida, estado mensual, semana en la web e informe
 * enviado a mano). Funciones puras: reciben los datos ya calculados y devuelven asunto, texto y HTML.
 *
 * Voz: primera persona del singular, firmados por «zipnegocios». Con una sola persona hablan de «tú»; con varias,
 * de «ustedes», y el saludo nombra a todas. Los textos no dependen de la tecnología del cliente.
 */

export const SENDER_BRAND = SENDER_BRAND_NAME;
export const SERVICE_NAME = SENDER_SERVICE_NAME;

export { DEFAULT_SENDER };
export type ClientEmail = { subject: string; text: string; html: string };

export type ClientEmailBase = {
  /** Nombres de las personas a las que se dirige el correo (el principal primero). */
  names: string[];
  /** Nombre del cliente: se usa en el saludo cuando son cuatro personas o más. */
  clientName: string;
  /** Sitio o dominio que se muestra, por ejemplo «cafeaurora.com». */
  site: string;
  portalUrl: string;
  /** Quien firma: el responsable del cliente. */
  sender: ClientSender;
  /** Dirección pública de la app: de ahí sale el logo de la banda. */
  appUrl: string;
};

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
export function formatPoints(diff: number | null): string {
  if (diff === null) return "sin comparación";
  if (diff === 0) return "sin cambio";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
}

/** Saludo según cuántas personas son: una, hasta tres por nombre, más de tres al equipo. */
export function greeting(names: string[], clientName: string): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  const team = clientName.trim();
  if (list.length === 0) return team ? `Hola equipo de ${team},` : "Hola,";
  if (list.length > 3) return team ? `Hola equipo de ${team},` : "Hola equipo,";
  if (list.length === 1) return `Hola ${list[0]},`;
  return `Hola ${list.slice(0, -1).join(", ")} y ${list[list.length - 1]},`;
}

/** Elige la forma en singular o plural según haya una o varias personas. */
export const voice = (names: string[]) => (singular: string, plural: string) => (names.filter((n) => n.trim()).length > 1 ? plural : singular);

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
  | { k: "calm"; title: string; intro: string; steps: string[]; outro?: string }
  | { k: "buttons"; items: Array<{ label: string; url: string; alt?: boolean }> }
  | { k: "pin"; pin: string }
  | { k: "big"; value: string; caption: string }
  | { k: "bars"; rows: Array<{ label: string; value: number; delta: string; up: boolean }> }
  | { k: "log"; rows: Array<{ date: string; t: string }> }
  | { k: "ranked"; rows: Array<{ label: string; value: number }> }
  | { k: "scores"; rows: Array<{ label: string; mobile: number; desktop: number; mobileDelta: number | null; desktopDelta: number | null }> };

const TD = `padding:8px 8px;border-bottom:1px solid ${C.line};vertical-align:top;font-size:14px`;

function scoreCell(score: number, diff: number | null): string {
  const band = scoreBand(score);
  const [bg, fg] = band.tone === "ok" ? [C.okBg, C.okInk] : band.tone === "warning" ? [C.warnBg, C.warnInk] : ["#FEE2E2", "#7F1D1D"];
  const word = band.word[0]!.toUpperCase() + band.word.slice(1);
  const dc = diff !== null && diff > 0 ? `color:${C.ok};font-weight:bold` : `color:${EMAIL.muted}`;
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
    case "calm":
      return (
        `<div style="background:${C.okBg};color:${C.okInk};border-left:4px solid ${C.ok};padding:14px 16px;margin:4px 0 18px">` +
        `<div style="font-size:17px;font-weight:bold;margin-bottom:6px">${esc(b.title)}</div>` +
        `<p style="margin:0 0 10px">${inline(b.intro)}</p>` +
        `<ol style="margin:0 0 10px;padding-left:20px">${b.steps.map((x) => `<li style="margin-bottom:4px">${inline(x)}</li>`).join("")}</ol>` +
        (b.outro ? `<p style="margin:0">${inline(b.outro)}</p>` : "") +
        `</div>`
      );
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
    case "calm":
      return [b.title.toUpperCase(), plain(b.intro), ...b.steps.map((x, i) => `${i + 1}. ${plain(x)}`), ...(b.outro ? [plain(b.outro)] : []), ""];
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

export type ComposeInput = { subject: string; preview: string; names: string[]; clientName: string; sender: ClientSender; appUrl: string; blocks: Block[]; footerNote?: string };
export type { Block as EmailBlock };

/** Arma el correo completo: banda con tu nombre, saludo, bloques, firma y pie. Lo comparten todos los correos al cliente. */
export function composeClientEmail(input: ComposeInput): ClientEmail {
  const hello = greeting(input.names, input.clientName);
  const html =
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(input.preview)}</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${EMAIL.ink};max-width:600px;background:#FFFFFF">` +
    clientEmailBand(input.sender, input.appUrl) +
    `<div style="padding:20px;border:1px solid ${C.line};border-top:0">` +
    `<p style="margin:0 0 14px">${esc(hello)}</p>` +
    input.blocks.map(blockHtml).join("") +
    `<p style="margin:0 0 14px"><b>${esc(input.sender.name)}</b><br>${esc(input.sender.brand)}</p>` +
    clientEmailFooter(input.sender, input.footerNote) +
    `</div></div>`;
  const text = [hello, "", ...input.blocks.flatMap(blockText), ...clientTextSignature(input.sender, input.footerNote)].join("\n");
  return { subject: input.subject, text, html };
}

// ---------------------------------------------------------------- bienvenida

/** Datos citados en «Por qué esto importa». Ver docs/borradores-correos.md (sección Fuentes). Revisar las fechas cada trimestre. */
export const WHY_SPEED =
  "**La velocidad se nota en el negocio.** En un estudio de Deloitte y 55 para Google (37 marcas, más de 30 millones de sesiones), mejorar 0,1 segundos la velocidad móvil se asoció con un 9,2 % más de gasto en tiendas online y un 21,6 % más de visitantes que llegan al formulario en sitios que captan clientes.";
export const WHY_VULNERABILITIES =
  "**Las vulnerabilidades son la puerta de entrada más común.** Según el informe de Verizon de 2026, el 31 % de las brechas de seguridad empieza con una vulnerabilidad de software, por encima de las contraseñas robadas. Y usar componentes vulnerables o desactualizados (librerías, dependencias, plataformas y APIs, incluidas las dependencias de las dependencias) está entre los diez riesgos principales del Top 10 de OWASP.";
/** `eolNote` es la frase de fin de soporte de una de las tecnologías (PHP, Node.js…), o null si no aplica: queda como ejemplo. */
export const whyLayers = (eolNote: string | null) =>
  `**Todo lo que sostiene un activo digital caduca.** Son muchas capas que envejecen a distinto ritmo: lenguajes y plataformas${eolNote ? ` (por ejemplo, ${eolNote.replace(/\.$/, "")})` : ""}, librerías y dependencias, APIs y servicios de terceros, integraciones, servidor, dominios, certificados y enrutamiento. Cuando una se desactualiza o se rompe, las demás lo sienten.`;
export const WHY_OBSERVABILITY =
  "**Por eso hace falta observabilidad en todas las capas.** Tener a la vista la aplicación, las herramientas de terceros, las integraciones, el servidor, los dominios y el enrutamiento a la vez, con criterio de ingeniería, para actuar antes de que algo falle y mantener todo al día. No es un trabajo de una sola vez: es lo que sostiene este acompañamiento mensual.";

/** Un producto del cliente tal como se presenta en la bienvenida. */
export type WelcomeProduct = {
  /** Dirección que se muestra, por ejemplo «cafeaurora.com». */
  site: string;
  /** Qué es, con sus palabras: «tienda online», «app móvil iOS»… */
  solutions: string[];
  /** En qué está hecho: «Shopify», «Swift», «Firebase»… */
  techs: string[];
  /** Qué servicios del acompañamiento incluye (ver `SERVICE_KEYS`). */
  services: string[];
};

export type WelcomeInput = ClientEmailBase & {
  products: WelcomeProduct[];
  /** Frase de fin de soporte de una de las tecnologías, o null. */
  eolNote: string | null;
  pin: string;
};

const joinList = (a: string[]) => (a.length <= 1 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} y ${a[a.length - 1]}`);

/** Lo que se revisa en cada servicio, en plural: los productos pueden ser de cualquier tipo. */
const SERVICE_ASPECT: Record<ServiceKey, string> = {
  web: "cómo funcionan y qué tan rápido cargan",
  seo: "cómo se encuentran en Google y de dónde llegan sus visitas",
  server: "cómo responden el servidor y los servicios",
  deps: "cómo están sus dependencias e integraciones",
  domain: "cómo están el dominio, el DNS y los certificados",
  security: "cómo están en seguridad y actualizaciones",
};

/** Los párrafos con que abre la bienvenida (presentación, productos, alcance y para qué). Lo usa también la vista previa del formulario. */
export function welcomeOpening(i: { names: string[]; products: WelcomeProduct[]; sender: ClientSender }): Block[] {
  const T = voice(i.names);
  const used = unionServices(i.products);
  const aspects = SERVICE_KEYS.filter((k) => used.has(k)).map((k) => SERVICE_ASPECT[k]);
  const many = i.products.length > 1;
  return [
    {
      k: "p",
      t: T(
        `Soy **${i.sender.name}** (${i.sender.brand}), quien se encarga de tus activos digitales. Te escribo desde esta dirección nueva para enviarte los informes: si no la reconoces, es normal, soy yo.`,
        `Soy **${i.sender.name}** (${i.sender.brand}), quien se encarga de sus activos digitales. Les escribo desde esta dirección nueva para enviarles los informes: si no la reconocen, es normal, soy yo.`,
      ),
    },
    { k: "p", t: `Desde hoy ${T("tus", "sus")} activos digitales tienen un acompañamiento técnico de punta a punta:` },
    {
      k: "list",
      items: i.products.map((x) => `**${x.site}** · ${joinList(x.solutions)}${x.techs.length > 0 ? ` en ${joinList(x.techs)}` : ""}`),
    },
    {
      k: "p",
      t: `Con mi equipo revisamos cada aspecto${many ? " de cada uno" : ""}${aspects.length > 0 ? `: ${joinList(aspects)}` : ""}. El objetivo es detectar cualquier falla antes de que la noten ${T("tus", "sus")} usuarios y que todo trabaje bien.`,
    },
    {
      k: "p",
      t: `Y no solo por lo técnico: con los datos en la mano podemos decidir juntos, también con criterio comercial, cómo hacer evolucionar ${T("tus", "sus")} activos digitales a medida que ${T("tu", "su")} público lo pida y la tecnología lo exija.`,
    },
  ];
}

export function buildWelcomeEmail(i: WelcomeInput): ClientEmail {
  const T = voice(i.names);
  const used = unionServices(i.products);
  const many = i.products.length > 1;
  const has = (k: ServiceKey) => used.has(k);
  const cubre: string[] = [
    ...(has("web")
      ? [
          "**Velocidad y calidad de cada página:** medidas automáticamente en móvil y escritorio, con lo que hay que mejorar.",
          `**Experiencia real de ${T("tus", "sus")} visitantes:** cómo vivieron la velocidad personas de verdad (datos de Chrome, últimos 28 días).`,
        ]
      : []),
    ...(has("seo")
      ? [
          `**Visitas y visibilidad:** de dónde llegan (buscadores, redes sociales, otros sitios), con qué palabras ${T("te buscan", "los buscan")} en Google y qué páginas funcionan; también las visitas desde asistentes de IA.`,
          "**Salud SEO:** una revisión técnica para que Google encuentre y muestre bien lo que publicas.",
        ]
      : []),
    ...(has("server") ? ["**Servidor, servicios y APIs:** yo los superviso y los reviso con regularidad."] : []),
    ...(has("deps") ? ["**Dependencias e integraciones:** librerías, paquetes, APIs y herramientas de terceros: que estén al día y que sigan funcionando."] : []),
    ...(has("domain") ? ["**Dominio, DNS y certificados:** que nada venza por sorpresa y que el enrutamiento funcione."] : []),
    ...(has("security") ? ["**Seguridad y actualizaciones:** yo las superviso y las aplico."] : []),
  ];
  const tableRows: string[][] = [
    ...(has("seo")
      ? [["**Cada lunes**", `**${T("Tu", "Su")} semana en la web**\nCuántas visitas ${T("tuviste", "tuvieron")}, de dónde llegaron (Google, Instagram, WhatsApp, Facebook, TikTok, LinkedIn…), con qué palabras ${T("te buscaron", "los buscaron")} y qué páginas funcionaron.`]]
      : []),
    [
      "**Una vez al mes**",
      `**Estado general**\n${has("web") ? "Velocidad, experiencia real de los visitantes, " : ""}${has("seo") ? "visitas y visibilidad en Google, " : ""}lo que atendimos y lo que sigue.`,
    ],
    ["**Solo si hace falta**", `**Aviso de incidencia**\n${T("Te escribo", "Les escribo")} yo cuando algo ya está atendido, o necesito algo de ${T("ti", "ustedes")}.`],
  ];
  const blocks: Block[] = [
    ...welcomeOpening(i),
    {
      k: "calm",
      title: "Si ves números bajos, no te alarmes",
      intro: `Al empezar es normal que algunos valores salgan por debajo del rango esperado: velocidad en el móvil, SEO, accesibilidad, integraciones o ajustes pendientes. No es un desastre ni un problema de ${T("tu", "su")} negocio: es el **punto de partida**.`,
      steps: [
        "**Hoy:** el punto de partida, tal como está.",
        "**Las próximas semanas:** voy corrigiendo de forma progresiva, con los ajustes, los parches y las actualizaciones que hagan falta para dejar todo optimizado, al día y con tecnología de punta.",
        "**Cada mes:** el informe de «Estado general» muestra cómo evoluciona y qué corregimos. En el portal, los valores se actualizan solos.",
      ],
      outro: `Y si ${T("tus", "sus")} valores ya están bien, perfecto: ${T("sigue tranquilo", "sigan tranquilos")}, los mantenemos así.`,
    },
    {
      k: "p",
      t: `**${T("No tienes que hacer nada", "No tienen que hacer nada")}.** Si algo falla, una herramienta se actualiza o una página o producto nuevo necesita ajustes, yo me encargo. Esto es lo que ${T("vas a recibir", "van a recibir")}:`,
    },
    { k: "table", head: ["Cuándo", "Qué"], rows: tableRows },
    { k: "p", t: has("seo") ? "**Un correo por semana y uno al mes**; fuera de eso, solo si hay una incidencia." : "**Un correo al mes**; fuera de eso, solo si hay una incidencia." },
    ...(cubre.length > 0 ? ([{ k: "h", t: "Qué cubrimos" }, { k: "list", items: cubre }] as Block[]) : []),
    {
      k: "p",
      t: T(
        "Cuando quieras mirar tú mismo, tienes tu portal, siempre actualizado:",
        `Cuando quieran mirar ustedes mismos, tienen su portal, siempre actualizado. Es un solo acceso para todo el equipo${many ? ", con todos sus activos" : ""}:`,
      ),
    },
    { k: "pin", pin: i.pin },
    { k: "buttons", items: [{ label: "Abrir el portal", url: i.portalUrl }] },
    {
      k: "fine",
      t: T(
        "Lo puedes instalar como app en el móvil. Ahí mismo, en «Informes», descargas dos informes en PDF: un resumen y el detalle de ingeniería.",
        "Lo pueden instalar como app en el móvil. Ahí mismo, en «Informes», descargan dos informes en PDF: un resumen y el detalle de ingeniería. Si alguien cambia el PIN, les llega a todos.",
      ),
    },
    { k: "fine", t: `**Recuerda:** si en el portal ${T("ves", "ven")} valores por debajo de la meta, son el punto de partida. La mejora se ve mes a mes.` },
    { k: "h", t: "Por qué esto importa" },
    { k: "list", items: [WHY_SPEED, WHY_VULNERABILITIES, whyLayers(i.eolNote), WHY_OBSERVABILITY] },
    { k: "fine", t: `Fuentes: Deloitte y 55 para Google (web.dev), Verizon DBIR 2026, OWASP Top 10 (edición 2021, A06)${i.eolNote ? ", endoflife.date" : ""}.` },
    {
      k: "p",
      t: i.sender.whatsapp
        ? T(
            "Cualquier duda, o una idea para tu negocio, respóndeme este correo o escríbeme por WhatsApp. Por ahí también cambiamos la frecuencia de los correos o sumamos a alguien más al equipo.",
            "Cualquier duda, o una idea para su negocio, respóndanme este correo o escríbanme por WhatsApp. Por ahí también cambiamos la frecuencia de los correos o sumamos a alguien más al equipo.",
          )
        : T(
            "Cualquier duda, o una idea para tu negocio, respóndeme este correo. Por ahí también cambiamos la frecuencia de los correos o sumamos a alguien más al equipo.",
            "Cualquier duda, o una idea para su negocio, respóndanme este correo. Por ahí también cambiamos la frecuencia de los correos o sumamos a alguien más al equipo.",
          ),
    },
  ];
  return composeClientEmail({
    subject: `${T("Tus", "Sus")} activos digitales ahora tienen acompañamiento técnico de punta a punta`,
    preview: T(
      "Qué revisamos, qué vas a recibir y cómo verlo cuando quieras. No tienes que hacer nada.",
      "Qué revisamos, qué van a recibir y cómo verlo cuando quieran. No tienen que hacer nada.",
    ),
    names: i.names,
    clientName: i.clientName,
    sender: i.sender,
    appUrl: i.appUrl,
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
  scores: Array<{ label: string; mobile: number; desktop: number; mobileDelta: number | null; desktopDelta: number | null }>;
  /** Solo true si el plan incluye servidor y el administrador confirmó la revisión del mes. */
  serverConfirmed: boolean;
  actions: Array<{ date: string; text: string }>;
  upcoming: string | null;
  newPages: string | null;
  /** Visitas del mes y de dónde llegaron; null si no hay tráfico visible para el cliente o el mes no está completo. */
  traffic?: { visits: number; deltaPct: number | null; sources: Array<{ label: string; visits: number; deltaPct: number | null }> } | null;
  /** Search Console del mes; null si no hay datos completos. */
  search?: { clicks: number; clicksDeltaPct: number | null; impressions: number; position: number | null; queries: Array<{ query: string; clicks: number }> } | null;
  /** Experiencia real de los visitantes (Chrome UX Report); null si no hay datos. */
  field?: { verdict: "passed" | "failed" | "no-data"; items: Array<{ label: string; value: string; word: string }> } | null;
  /** El proyecto está «en mejora inicial»: los valores son el punto de partida. El estado del mes lo explica con calma. */
  initialImprovement?: boolean;
  reportUrl: string | null;
  /** El informe de ingeniería en PDF. */
  engineeringUrl?: string | null;
};

const DIRECT_FINE =
  "«Directo o sin identificar» incluye a quien escribe la dirección, usa un marcador o llega desde aplicaciones que no informan de dónde vienen (por ejemplo, mensajes privados). Con enlaces con parámetros UTM puedo decirte más.";
const VERDICT_WORD = { passed: "aprobada", failed: "por mejorar", "no-data": "sin veredicto" } as const;

export function buildMonthlyEmail(i: MonthlyInput): ClientEmail {
  const T = voice(i.names);
  const perf = i.scores[0];
  const blocks: Block[] = [
    { k: "p", t: `Este es el resumen de ${i.monthLabel} de **${i.site}**.` },
    i.initialImprovement
      ? {
          k: "calm",
          title: "Seguimos en la fase de mejora inicial",
          intro: "Estos valores todavía son el **punto de partida**: es normal que algunos estén por debajo de la meta. Abajo está lo que corregimos este mes; el mes que viene verás cómo se mueven.",
          steps: [],
        }
      : { k: "status", label: "Estado del mes", t: i.statusLine },
    { k: "h", t: "En números" },
    { k: "fine", t: `Promedio del mes, frente a ${i.prevMonthLabel}` },
    { k: "scores", rows: i.scores },
    ...(i.field && i.field.items.length > 0
      ? ([
          { k: "h", t: "Experiencia real de tus visitantes" },
          { k: "p", t: `Evaluación de Core Web Vitals en el móvil: **${VERDICT_WORD[i.field.verdict]}**. ${i.field.items.map((x) => `${x.label} ${x.value} (${x.word})`).join(" · ")}.` },
        ] as Block[])
      : []),
    ...(i.traffic
      ? ([
          { k: "h", t: "Visitas del mes" },
          { k: "big", value: formatCount(i.traffic.visits), caption: i.traffic.deltaPct === null ? "visitas" : `visitas · **${formatPct(i.traffic.deltaPct)}** frente a ${i.prevMonthLabel}` },
          { k: "bars", rows: i.traffic.sources.map((s) => ({ label: s.label, value: s.visits, delta: formatPct(s.deltaPct), up: s.deltaPct === null || s.deltaPct > 0 })) },
          ...(i.traffic.sources.some((s) => s.label === "Directo o sin identificar") ? ([{ k: "fine", t: DIRECT_FINE }] as Block[]) : []),
        ] as Block[])
      : []),
    ...(i.search
      ? ([
          { k: "h", t: "Visibilidad en Google" },
          {
            k: "p",
            t: `Clics desde Google: **${formatCount(i.search.clicks)}**${i.search.clicksDeltaPct === null ? "" : ` (${formatPct(i.search.clicksDeltaPct)})`} · Veces que ${T("apareciste", "aparecieron")}: **${formatCount(i.search.impressions)}**${i.search.position === null ? "" : ` · Posición media: **${String(i.search.position).replace(".", ",")}**`}`,
          },
          ...(i.search.queries.length > 0 ? ([{ k: "p", t: `Con qué palabras ${T("te buscaron", "los buscaron")} más: ${i.search.queries.map((q) => `«${q.query}» (${formatCount(q.clicks)} clics)`).join(" · ")}.` }] as Block[]) : []),
        ] as Block[])
      : []),
    ...(i.serverConfirmed ? ([{ k: "p", t: "**Servidor y servicios:** supervisados durante todo el mes, sin incidencias." }] as Block[]) : []),
    { k: "h", t: "Lo que atendimos este mes" },
    i.actions.length > 0
      ? { k: "log", rows: i.actions.map((a) => ({ date: a.date, t: a.text })) }
      : { k: "p", t: "Este mes no hizo falta intervenir: todo se mantuvo estable." },
    ...(i.upcoming ? ([{ k: "h", t: "Lo que viene" }, { k: "p", t: i.upcoming }] as Block[]) : []),
    ...(i.newPages ? ([{ k: "h", t: "Páginas nuevas que detectamos" }, { k: "p", t: i.newPages }] as Block[]) : []),
    {
      k: "buttons",
      items: [
        { label: "Ver el detalle en el portal", url: i.portalUrl },
        ...(i.reportUrl ? [{ label: "Descargar el resumen en PDF", url: i.reportUrl, alt: true }] : []),
        ...(i.engineeringUrl ? [{ label: "Descargar el informe de ingeniería", url: i.engineeringUrl, alt: true }] : []),
      ],
    },
    { k: "p", t: T("Cualquier cosa que quieras que revise, respóndeme este correo.", "Cualquier cosa que quieran que revise, respóndanme este correo.") },
  ];
  const head = perf ? ` Rendimiento móvil ${perf.mobile}${perf.mobileDelta === null ? "" : ` (${formatPoints(perf.mobileDelta)})`}` : "";
  return composeClientEmail({
    subject: i.tone === "ok" && !i.initialImprovement ? `${i.site}: ${i.monthLabel} en orden.${head}` : `${i.site}: resumen de ${i.monthLabel}.${head}`,
    preview: "Lo que revisamos, lo que atendimos y lo que viene.",
    names: i.names,
    clientName: i.clientName,
    sender: i.sender,
    appUrl: i.appUrl,
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
  /** Search Console: null si el proyecto no tiene esos datos. */
  search: { clicks: number; clicksDeltaPct: number | null; impressions: number } | null;
  /** Orígenes ya agrupados y en orden; `deltaPct` null si no había visitas la semana anterior. */
  sources: Array<{ label: string; visits: number; deltaPct: number | null }>;
  /** Visitas desde asistentes de IA: un mínimo observado que ya está contado dentro de otros orígenes. */
  ai: { visits: number; deltaPct: number | null } | null;
  topPages: Array<{ label: string; visits: number }>;
  /** Con qué palabras buscaron en Google (Search Console): las principales de la semana. */
  queries?: Array<{ query: string; clicks: number }>;
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
    ...(i.search
      ? ([
          {
            k: "p",
            t: `Clics desde Google: **${formatCount(i.search.clicks)}**${quiet || i.search.clicksDeltaPct === null ? "" : ` (${formatPct(i.search.clicksDeltaPct)})`} · Veces que ${T("apareciste", "aparecieron")}: **${formatCount(i.search.impressions)}**`,
          },
        ] as Block[])
      : []),
    ...(i.queries && i.queries.length > 0
      ? ([{ k: "p", t: `Con qué palabras ${T("te buscaron", "los buscaron")} más: ${i.queries.map((q) => `«${q.query}» (${formatCount(q.clicks)} clics)`).join(" · ")}.` }] as Block[])
      : []),
    { k: "h", t: "De dónde llegaron" },
    { k: "bars", rows: i.sources.map((s) => ({ label: s.label, value: s.visits, delta: pct(s.deltaPct), up: !quiet && (s.deltaPct === null || s.deltaPct > 0) })) },
    ...(i.sources.some((s) => s.label === "Directo o sin identificar") ? ([{ k: "fine", t: DIRECT_FINE }] as Block[]) : []),
    ...(i.ai && i.ai.visits > 0
      ? ([{ k: "fine", t: `Visitas desde asistentes de IA (un mínimo observado, ya incluidas arriba): **${formatCount(i.ai.visits)}**${quiet ? "" : ` (${formatPct(i.ai.deltaPct)})`}.` }] as Block[])
      : []),
    { k: "h", t: "Las 3 páginas más vistas" },
    { k: "ranked", rows: i.topPages.slice(0, 3).map((p) => ({ label: p.label, value: p.visits })) },
    { k: "status", label: "En una línea", t: i.summaryLine },
    { k: "buttons", items: [{ label: "Ver más en el portal", url: i.portalUrl }] },
  ];
  const delta = !quiet && i.visitsDeltaPct !== null ? ` (${formatPct(i.visitsDeltaPct)})` : "";
  return composeClientEmail({
    subject: `${T("Tu", "Su")} semana en la web: ${formatCount(i.visits)} visitas${delta} · ${i.rangeShort}`,
    preview: "De dónde llegaron y qué páginas funcionaron.",
    names: i.names,
    clientName: i.clientName,
    sender: i.sender,
    appUrl: i.appUrl,
    blocks,
    footerNote: `Datos hasta el ${i.dataThrough}. Para cambiar la frecuencia, respóndeme este correo.`,
  });
}

// ---------------------------------------------------------------- informe manual

export type ManualReportInput = ClientEmailBase & {
  /** «últimos 30 días». */
  periodLabel: string;
  summaryLine: string;
  /** Cifras clave ya redactadas («Rendimiento medio: 78 en móvil», «Visitas: 9.394 (+4 %)»); vacío si no hay. */
  facts?: string[];
};

/** Correo del botón «Enviar a …»: acompaña los dos PDF (resumen e ingeniería) que adjunta quien envía. */
export function buildClientReportEmail(i: ManualReportInput): ClientEmail {
  const T = voice(i.names);
  const names = (list: readonly { title: string }[]) => list.map((s) => s.title).join(" · ");
  const blocks: Block[] = [
    {
      k: "p",
      t: `${T("Te adjunto", "Les adjunto")} los dos informes de **${i.site}** de los ${i.periodLabel}, en PDF:`,
    },
    {
      k: "list",
      items: [
        `**Informe resumen** (${SUMMARY_SECTIONS.length} apartados, en lenguaje claro): ${names(SUMMARY_SECTIONS)}.`,
        `**Informe de ingeniería** (${ENGINEERING_SECTIONS.length} apartados, medición por medición): ${names(ENGINEERING_SECTIONS)}.`,
      ],
    },
    { k: "status", label: "Lo más importante", t: i.summaryLine },
    ...(i.facts && i.facts.length > 0 ? ([{ k: "list", items: i.facts }] as Block[]) : []),
    { k: "p", t: `${T("Siempre puedes ver", "Siempre pueden ver")} el estado actualizado, y descargar los informes de nuevo, en ${T("tu", "su")} portal:` },
    { k: "buttons", items: [{ label: "Abrir el portal", url: i.portalUrl }] },
  ];
  return composeClientEmail({ subject: `Informes técnicos web · ${i.site} · ${i.periodLabel}`, preview: `Los informes de ${i.site}, ${i.periodLabel}, en PDF.`, names: i.names, clientName: i.clientName, sender: i.sender, appUrl: i.appUrl, blocks });
}
