import { BRAND_NAME } from "@/lib/brand";
import { EMAIL, EMAIL_TEXT_SIGNATURE, emailBrandBand, emailButton, emailFooter } from "./email-theme";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" });

/**
 * Lo que puede hacer una persona del equipo en la plataforma, para la invitación. Va por secciones numeradas: primero lo que
 * gestiona, luego lo que recibe el cliente y, al final, lo que todavía está en camino. Si cambia lo que hace el panel,
 * se actualiza aquí.
 */
export const STAFF_GUIDE: ReadonlyArray<{ title: string; items: string[] }> = [
  {
    title: "Tus clientes y sus proyectos",
    items: [
      "Creas clientes. Quien crea un cliente es su responsable: firma con su nombre y su WhatsApp todos los correos que ese cliente recibe, le llegan las alertas de sus proyectos y es el contacto de su portal. Se puede reasignar.",
      "Cada cliente tiene proyectos (un sitio, una tienda o una aplicación), en desarrollo o en producción. Los que están en producción se auditan solos.",
      "En cada proyecto eliges qué páginas se vigilan: las descubres desde el sitemap o las agregas a mano. Las páginas con inicio de sesión se auditan con un usuario de prueba.",
      "Puedes ponerle el logotipo al cliente, cambiar sus direcciones, archivarlo, restaurarlo o eliminarlo.",
    ],
  },
  {
    title: "Auditorías y alertas",
    items: [
      "Auditorías Lighthouse en móvil y escritorio: rendimiento, SEO, accesibilidad, buenas prácticas y navegación con agentes, con el informe completo en español y las evidencias en la captura de la página.",
      "Se programan solas (cada semana o cada día) o las lanzas tú cuando quieras. El primer escaneo audita todas las páginas de una vez.",
      "Defines los umbrales de cada proyecto: si una puntuación baja de la meta se abre una alerta y recibes un correo agrupado. Avisas al cliente por WhatsApp con un clic.",
      "Datos reales de usuarios (Chrome UX Report) al lado de las mediciones de laboratorio.",
    ],
  },
  {
    title: "SEO, visibilidad y tráfico",
    items: [
      "Conectas Search Console y Google Analytics: clics, impresiones, posición, visitas por canal, país y página, las redes sociales por separado (Instagram, LinkedIn, TikTok…) y las visitas que llegan desde asistentes de IA.",
      "Auditoría técnica del sitio: un rastreador lo revisa como lo haría un buscador y te dice qué corregir.",
      "Idiomas del sitio: separas las cifras por idioma.",
    ],
  },
  {
    title: "Lo que recibe tu cliente",
    items: [
      "Un portal con un enlace fijo y un PIN de 6 dígitos, sin usuarios ni contraseñas, que se instala como app en el móvil. Ve sus proyectos en producción: el estado de cada página, su evolución, lo que hay que mejorar, sus rutas, el tráfico y la búsqueda (si lo activas) y los informes en PDF.",
      "Dos informes en PDF, el resumen y el de ingeniería, que descarga solo o que le envías por correo con un clic.",
      "Tres correos firmados por ti: la bienvenida (con el PIN, para él y su equipo en copia), «Tu semana en la web» cada lunes y «Estado general» el primer lunes del mes. Los dos últimos están apagados hasta que los enciendas en su ficha.",
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
    title: "Agentes (MCP)",
    items: [
      "Un servidor MCP para conectar agentes como Claude: consultan tus clientes, leen auditorías y lanzan nuevas. También se conecta como conector de claude.ai.",
      "Cada clave tiene su nivel (solo lectura, más auditorías, más configuración) y su alcance: todos los clientes o solo los que elijas. Ningún agente puede borrar, cambiar la fase ni suspender a un cliente.",
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
    items: ["Invitar o quitar personas del equipo (Panel → Equipo). Todo lo demás lo administras tú igual que el propietario.", "Los respaldos diarios de toda la base se hacen solos; restaurarlos se hace desde la consola del servicio."],
  },
];

const guideText = (): string[] => [
  "QUÉ PUEDES HACER EN LA PLATAFORMA",
  "",
  "Primero: entra a «Mi perfil» y completa tu nombre, tu apellido y tu WhatsApp. Es lo que ven tus clientes: firman los correos que reciben.",
  "",
  ...STAFF_GUIDE.flatMap((sec, i) => [`${i + 1}. ${sec.title}`, ...sec.items.map((it) => `   - ${it}`), ""]),
];

const guideHtml = (): string =>
  `<p style="margin:26px 0 6px;font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase">Qué puedes hacer en la plataforma</p>` +
  `<p style="margin:0 0 14px;padding:10px 12px;background:#F3F4F6;border-left:4px solid ${EMAIL.lime}"><b>Primero:</b> entra a «Mi perfil» y completa tu nombre, tu apellido y tu WhatsApp. Es lo que ven tus clientes: firman los correos que reciben.</p>` +
  STAFF_GUIDE.map(
    (sec, i) =>
      `<p style="margin:16px 0 4px;font-weight:bold">${i + 1}. ${esc(sec.title)}</p>` +
      `<ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.5">${sec.items.map((it) => `<li style="margin-bottom:5px">${esc(it)}</li>`).join("")}</ul>`,
  ).join("");


/** Correo con el enlace para crear la contraseña (invitación) o para fijar una nueva (restablecimiento). Habla de "tú". */
export function buildInviteEmail(input: { kind: "invite" | "reset"; invitedBy: string; link: string; expiresAt: Date }): { subject: string; text: string; html: string } {
  const invite = input.kind === "invite";
  const subject = invite ? `Te invitaron a ${BRAND_NAME}` : `Crea una contraseña nueva en ${BRAND_NAME}`;
  const line = invite
    ? `${input.invitedBy} te invitó a administrar ${BRAND_NAME} junto con su equipo. Crea tu contraseña para entrar.`
    : `${input.invitedBy} te envió este enlace para que crees una contraseña nueva en ${BRAND_NAME}. La anterior dejará de servir.`;
  const expires = `El enlace sirve una sola vez y vence el ${dateFmt.format(input.expiresAt)} (UTC).`;
  const ignore = "Si no lo esperabas, puedes ignorar este correo: sin el enlace nadie puede entrar con tu correo.";
  const label = invite ? "Crear mi contraseña" : "Crear contraseña nueva";
  const text = ["Hola,", "", line, "", `${label}:`, input.link, "", expires, ignore, "", ...(invite ? guideText() : []), ...EMAIL_TEXT_SIGNATURE].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};max-width:560px">` +
    emailBrandBand(input.link) +
    `<p style="margin:16px 0 0">Hola,</p>` +
    `<p>${esc(line)}</p>` +
    `<p style="margin:20px 0">${emailButton(esc(input.link), esc(label))}</p>` +
    `<p style="color:${EMAIL.muted};font-size:14px">${esc(expires)}</p>` +
    `<p style="color:${EMAIL.muted};font-size:14px">${esc(ignore)}</p>` +
    (invite ? guideHtml() : "") +
    emailFooter() +
    `</div>`;
  return { subject, text, html };
}
