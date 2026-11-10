import { BRAND_NAME } from "@/lib/brand";
import { EMAIL, emailBrandBand, emailButton, emailFooter } from "./email-theme";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Texto con **negrita**, ya escapado. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" });

/**
 * Lo que puede hacer una persona del equipo en la plataforma, para la invitación. Va por secciones numeradas: primero lo que
 * gestiona y los dos modos de uso, luego lo que recibe el cliente y, al final, lo que todavía está en camino. Si cambia lo que
 * hace el panel, se actualiza aquí.
 */
export const STAFF_GUIDE: ReadonlyArray<{ title: string; items: string[] }> = [
  {
    title: "Tus clientes y sus proyectos",
    items: [
      "Creas clientes. Quien crea un cliente es su responsable: firma con su nombre y su WhatsApp todos los correos que ese cliente recibe, le llegan las alertas de sus proyectos y es el contacto de su portal. Se puede reasignar.",
      "Ves tus clientes y lo que otra persona del equipo te comparta, entero o proyecto por proyecto. Nadie ve los tuyos si no los compartes; el propietario ve todo.",
      "Un cliente puede tener varios productos a la vez (un sitio, una tienda, una aplicación, una plataforma de e-learning, un CRM, un chatbot…). Cada producto es un proyecto, en desarrollo o en producción, y la bienvenida los presenta todos en un solo correo.",
      "En cada proyecto eliges qué páginas se vigilan: las descubres desde el sitemap o las agregas a mano. Las páginas con inicio de sesión se auditan con un usuario de prueba.",
      "Puedes ponerle el logotipo al cliente, cambiar sus direcciones, archivarlo, restaurarlo o eliminarlo.",
    ],
  },
  {
    title: "Los dos modos de uso: desarrollo y producción",
    items: [
      "**Modo desarrollo (estás construyendo o mejorando).** El proyecto no tiene agenda, alertas ni correos al cliente, y su portal no lo muestra. Tú (o tu agente de IA) audita cuando quieras sobre una versión de pruebas y lo usas como tablero de calidad mientras desarrollas.",
      "**Con agentes de IA (MCP) en desarrollo.** El agente lee las auditorías: qué falla, por qué y cuánto se ahorraría al corregirlo. Con eso propone y aplica los ajustes técnicos, vuelve a auditar y compara. Los umbrales del proyecto hacen de criterio de aceptación: es desarrollo guiado por especificaciones (Spec-Driven Development) acelerado con IA.",
      "**Modo producción (el producto ya está publicado).** Todo es automático: las páginas vigiladas se auditan solas cada semana o cada día, si una puntuación baja de su umbral se abre una alerta y te llega un correo, y el cliente ve su portal y recibe sus correos.",
      "Pasar de un modo a otro es cambiar la fase del proyecto. El historial de las auditorías de desarrollo se conserva.",
    ],
  },
  {
    title: "Auditorías y alertas",
    items: [
      "Auditorías Lighthouse en móvil y escritorio: rendimiento, SEO, accesibilidad, buenas prácticas y navegación con agentes, con el informe completo en español y las evidencias en la captura de la página.",
      "En producción se programan solas; en desarrollo las lanzas tú o tu agente cuando quieras. El primer escaneo audita todas las páginas de una vez.",
      "Defines los umbrales de cada proyecto: en producción, si una puntuación baja de la meta se abre una alerta y recibes un correo agrupado; en desarrollo son la meta que persigues. Avisas al cliente por WhatsApp con un clic.",
      "Datos reales de usuarios (Chrome UX Report) al lado de las mediciones de laboratorio.",
    ],
  },
  {
    title: "SEO, visibilidad y tráfico",
    items: [
      "Conectas Search Console y Google Analytics: clics, impresiones, posición, las palabras con las que te buscan, visitas por canal, país y página, las redes sociales por separado y las visitas que llegan desde asistentes de IA.",
      "Auditoría técnica del sitio: un rastreador lo revisa como lo haría un buscador y te dice qué corregir. Sirve también en desarrollo, como lista de comprobación antes de publicar.",
      "Idiomas del sitio: separas las cifras por idioma.",
    ],
  },
  {
    title: "Lo que recibe tu cliente",
    items: [
      "Un portal con un enlace fijo y un PIN de 6 dígitos, sin usuarios ni contraseñas, que se instala como app en el móvil. Ve sus proyectos en producción: el estado de cada página, su evolución, lo que hay que mejorar, sus rutas, el tráfico y la búsqueda (si lo activas) y los informes en PDF.",
      "Dos informes en PDF, el resumen y el de ingeniería, que descarga solo o que le envías por correo con un clic.",
      "Tres correos firmados por ti: la bienvenida (con el PIN, para él y su equipo en copia), «Tu semana en la web» cada lunes y «Estado general» el primer lunes del mes. Los dos últimos están apagados hasta que los enciendas en su ficha.",
      "Si el cliente empieza con valores bajos, marcas el proyecto «en mejora inicial»: el portal, los PDF y el correo mensual explican que son el punto de partida y que vas a corregir de forma progresiva, para que no se alarme. Lo apagas cuando los valores se estabilicen.",
      "Si suspendes a un cliente, su portal muestra un aviso con tu contacto en lugar de los resultados.",
    ],
  },
  {
    title: "Lo que anotas tú",
    items: [
      "El registro de actuaciones: cada cosa que atiendes en un proyecto sale en «Lo que atendimos» del correo mensual.",
      "La confirmación mensual de la revisión del servidor, para que el correo pueda decir que se revisó.",
      "Pruebas con datos reales: te envías el correo a ti antes de que lo reciba el cliente.",
    ],
  },
  {
    title: "Agentes de IA (MCP): desarrollo y producción",
    items: [
      "Un servidor MCP para conectar agentes como Claude (Claude Code, claude.ai…). Leen tus proyectos, rutas, historial y el detalle de cada auditoría, y pueden lanzar auditorías y ajustar umbrales y páginas vigiladas según el nivel de la clave.",
      "**En desarrollo:** son el motor del desarrollo acelerado con IA. El agente audita la versión de pruebas, entiende qué falla y por qué, corrige, vuelve a auditar y compara hasta cumplir los umbrales (Spec-Driven Development).",
      "**En producción:** responden «¿cómo va este cliente?», explican por qué bajó una puntuación y qué corregir primero, y lanzan una auditoría puntual cuando hace falta.",
      "Cada clave tiene su nivel (solo lectura, más auditorías, más configuración) y su alcance, y nunca ve más que tú. Ningún agente puede borrar, cambiar la fase ni suspender a un cliente. Hay una guía de uso pensada para el propio agente.",
    ],
  },
  {
    title: "En camino",
    items: [
      "Integraciones por API con aplicaciones Node y WordPress.",
      "Más vistas en la misma plataforma: seguridad, servidor y operaciones (con alertas automáticas) y las APIs internas de cada proyecto.",
    ],
  },
  {
    title: "Solo la cuenta propietaria",
    items: [
      "Invitar o quitar personas del equipo (Panel → Equipo) y ver todos los clientes. Si alguien sale del equipo, sus clientes pasan al propietario.",
      "Los respaldos diarios de toda la base se hacen solos; restaurarlos se hace desde la consola del servicio.",
    ],
  },
];

const guideText = (): string[] => [
  "LO QUE PUEDES HACER EN LA PLATAFORMA",
  "",
  ...STAFF_GUIDE.flatMap((sec, i) => [`${i + 1}. ${sec.title}`, ...sec.items.map((it) => `   - ${plain(it)}`), ""]),
];

const guideHtml = (): string =>
  `<p style="margin:26px 0 6px;font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase">Lo que puedes hacer en la plataforma</p>` +
  STAFF_GUIDE.map(
    (sec, i) =>
      `<p style="margin:16px 0 4px;font-weight:bold">${i + 1}. ${esc(sec.title)}</p>` +
      `<ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.5">${sec.items.map((it) => `<li style="margin-bottom:5px">${inline(it)}</li>`).join("")}</ul>`,
  ).join("");

const greetingOf = (name: string | null | undefined) => (name?.trim() ? `Hola ${name.trim()},` : "Hola,");

export type InviteMailInput = {
  kind: "invite" | "reset";
  /** Quien invita (o envía el enlace): nombre y apellido, o su correo si no tiene nombre. Habla en primera persona. */
  inviterName: string;
  /** Nombre de pila de quien recibe, si se sabe. */
  inviteeName?: string | null;
  link: string;
  expiresAt: Date;
};

/**
 * Correo con el enlace para crear la contraseña (invitación) o para fijar una nueva (restablecimiento). Lo escribe una persona
 * a otra, en primera persona y con el nombre de quien recibe; la invitación trae además el listado de lo que se puede hacer.
 */
export function buildInviteEmail(input: InviteMailInput): { subject: string; text: string; html: string; preview: string } {
  const invite = input.kind === "invite";
  const hello = greetingOf(input.inviteeName);
  const me = input.inviterName;
  const expires = `El enlace es de un solo uso y vence el ${dateFmt.format(input.expiresAt)} (UTC).`;
  const ignore = invite
    ? "Si no esperabas esta invitación, puedes ignorarla: sin el enlace nadie puede entrar con tu correo."
    : "Si no lo esperabas, puedes ignorar este correo: sin el enlace nadie puede entrar con tu correo.";
  const label = invite ? "Crear mi contraseña" : "Crear contraseña nueva";
  const subject = invite ? `${me} te invita a ${BRAND_NAME}` : `Crea una contraseña nueva en ${BRAND_NAME}`;
  const preview = invite ? "Crea tu contraseña, completa tu perfil y empieza a atender a tus clientes desde la plataforma." : "Te envío este enlace para fijar una contraseña nueva.";

  const intro: string[] = invite
    ? [
        `Soy **${me}** y te invito a **${BRAND_NAME}**, la plataforma desde la que llevo la observabilidad de los activos digitales de mis clientes: su velocidad, su visibilidad, su tráfico y su salud técnica.`,
        "Con tu cuenta atenderás a **tus propios clientes** desde el mismo lugar: crea tu cartera o únete a la mía. Ellos verán tu nombre en cada correo y en su portal, y tú y yo trabajaremos sobre la misma plataforma.",
      ]
    : [`Te envío este enlace para que crees una contraseña nueva en **${BRAND_NAME}**. La anterior dejará de servir.`];
  const steps = [
    "Crea tu contraseña con el botón de abajo.",
    "Completa tu perfil: nombre, apellido y WhatsApp. Es lo que verán tus clientes.",
    "Lee abajo todo lo que puedes hacer en la plataforma.",
    "Crea tu primer cliente.",
  ];
  const close = invite ? "Cualquier duda, respóndeme este correo: me llega directo." : "";

  const text = [
    hello,
    "",
    ...intro.flatMap((p) => [plain(p), ""]),
    ...(invite ? ["PARA EMPEZAR", ...steps.map((x, i) => `${i + 1}. ${x}`), ""] : []),
    `${label}:`,
    input.link,
    "",
    expires,
    ignore,
    "",
    ...(close ? [close, ""] : []),
    me,
    "",
    ...(invite ? guideText() : []),
    `${BRAND_NAME} · zipnegocios`,
  ].join("\n");
  const html =
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preview)}</div>` +
    `<div style="font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};max-width:560px">` +
    emailBrandBand(input.link) +
    `<p style="margin:16px 0 0">${esc(hello)}</p>` +
    intro.map((p) => `<p>${inline(p)}</p>`).join("") +
    (invite ? `<p style="margin:0 0 4px"><b>Para empezar</b></p><ol style="margin:0 0 14px;padding-left:20px">${steps.map((x) => `<li style="margin-bottom:4px">${esc(x)}</li>`).join("")}</ol>` : "") +
    `<p style="margin:20px 0">${emailButton(esc(input.link), esc(label))}</p>` +
    `<p style="color:${EMAIL.muted};font-size:14px">${esc(expires)} ${esc(ignore)}</p>` +
    (close ? `<p>${esc(close)}</p>` : "") +
    `<p style="margin:0 0 14px"><b>${esc(me)}</b></p>` +
    (invite ? guideHtml() : "") +
    emailFooter() +
    `</div>`;
  return { subject, text, html, preview };
}
