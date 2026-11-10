// Envía (o guarda en disco) los cuatro correos al cliente con datos de ejemplo, para ver cómo llegan.
// Necesita las mismas variables SMTP que el servicio web.
//
//   En la consola del servicio web (ya tiene las variables): node send-test-emails-cli.cjs <correo> [opciones]
//   En local:  pnpm exec tsx --env-file=.env scripts/send-test-emails.ts <correo> [opciones]
//
// Opciones:
//   --cc=a@x.com,b@y.com   copia a más personas (así se ve el CC real)
//   --una-persona          saluda a una sola persona («tú») en lugar de a tres («ustedes»)
//   --tech=wp|shopify|next tecnología del cliente de ejemplo (por defecto wp)
//   --responsable=luis     firma como el segundo responsable (nombre y WhatsApp de ejemplo)
//   --solo=bienvenida,mensual,semanal,manual   envía solo esos
//   --dry-run=carpeta      no envía: escribe un .html y un .txt por correo en esa carpeta
//
// Variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM y APP_URL (de ahí sale el logo del correo;
// debe ser la dirección pública de la app).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SENDER, senderMailFields, type ClientSender } from "../src/server/domain/client-sender";
import { createMailer } from "../src/server/notify/mailer";
import {
  buildClientReportEmail,
  buildMonthlyEmail,
  buildWeeklyEmail,
  buildWelcomeEmail,
  type ClientEmail,
  type ClientEmailBase,
} from "../src/server/notify/client-emails";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const to = args.find((a) => !a.startsWith("--"));
  const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const flag = (name: string) => args.includes(`--${name}`);

  const dry = opt("dry-run");
  if (!to && !dry) {
    console.error("Falta el correo de destino. Ejemplo: node send-test-emails-cli.cjs tu@correo.com");
    process.exit(1);
  }

  const TECH = {
    wp: { label: "WordPress", kind: "sitio", includesServer: true, eolNote: "PHP 8.2 deja de recibir parches de seguridad el 31 de diciembre de 2026." },
    shopify: { label: "Shopify", kind: "tienda", includesServer: false, eolNote: null },
    next: { label: "Next.js", kind: "aplicación", includesServer: true, eolNote: "Node.js 20 dejó de recibir parches de seguridad el 30 de abril de 2026." },
  } as const;
  const techKey = (opt("tech") ?? "wp") as keyof typeof TECH;
  const tech = TECH[techKey];
  if (!tech) {
    console.error("--tech debe ser wp, shopify o next.");
    process.exit(1);
  }

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  // Quién firma: por defecto Gustavo; --responsable=luis prueba cómo ve el cliente a un segundo responsable.
const sender: ClientSender = opt("responsable") === "luis" ? { ...DEFAULT_SENDER, name: "Luis Porteles", whatsapp: "+1 555 010 0000", email: "luis@example.com" } : DEFAULT_SENDER;
const base: ClientEmailBase = {
  sender,
  appUrl,
    names: flag("una-persona") ? ["Ana"] : ["Ana", "Luis", "María"],
    clientName: "Café Aurora",
    site: "cafeaurora.com",
    portalUrl: `${appUrl}/c/cafe-aurora`,
  };

  const all: Record<string, ClientEmail> = {
    bienvenida: buildWelcomeEmail({ ...base, kind: tech.kind, techLabel: tech.label, includesServer: tech.includesServer, eolNote: tech.eolNote, pin: "000000" }),
    mensual: buildMonthlyEmail({
      ...base,
      monthLabel: "octubre",
      prevMonthLabel: "septiembre",
      tone: "ok",
      statusLine: "Mejoró la velocidad en el móvil y atendimos un aviso en la página de contacto.",
      scores: [
        { label: "Rendimiento", mobile: 78, desktop: 91, mobileDelta: 5, desktopDelta: 2 },
        { label: "Visibilidad (SEO)", mobile: 95, desktop: 96, mobileDelta: 0, desktopDelta: 0 },
        { label: "Accesibilidad", mobile: 88, desktop: 88, mobileDelta: 1, desktopDelta: 1 },
      ],
      serverConfirmed: tech.includesServer,
      actions: [
        { date: "14 oct", text: "Actualicé un componente a su última versión." },
        { date: "18 oct", text: "Ajusté las imágenes de la página Servicios, que tardaba en cargar en el móvil." },
        { date: "25 oct", text: "Detecté una caída de velocidad tras un cambio de contenido y la corregí el mismo día." },
      ],
      upcoming: "Revisión trimestral de tecnologías y versiones, en noviembre.",
      newPages: "2 páginas nuevas en octubre, ya en seguimiento automático.",
      traffic: {
        visits: 5380,
        deltaPct: 7,
        sources: [
          { label: "Buscadores (Google y otros)", visits: 2410, deltaPct: 9 },
          { label: "Instagram", visits: 620, deltaPct: 14 },
          { label: "WhatsApp", visits: 410, deltaPct: 22 },
          { label: "Directo o sin identificar", visits: 880, deltaPct: -3 },
          { label: "Otros sitios", visits: 390, deltaPct: 5 },
        ],
      },
      search: { clicks: 1390, clicksDeltaPct: 12, impressions: 41800, position: 7.2, queries: [{ query: "café de especialidad", clicks: 210 }, { query: "tostadores en bogotá", clicks: 140 }, { query: "café aurora", clicks: 120 }] },
      field: { verdict: "passed", items: [{ label: "LCP", value: "2.1 s", word: "bueno" }, { label: "INP", value: "140 ms", word: "bueno" }, { label: "CLS", value: "0.020", word: "bueno" }] },
      reportUrl: `${appUrl}/c/cafe-aurora/cafeaurora/informe?tipo=resumen&dias=30`,
      engineeringUrl: `${appUrl}/c/cafe-aurora/cafeaurora/informe?tipo=ingenieria&dias=30`,
    }),
    semanal: buildWeeklyEmail({
      ...base,
      rangeLabel: "2 al 8 de noviembre",
      rangeShort: "2 al 8 de nov",
      visits: 1240,
      visitsDeltaPct: 8,
      search: { clicks: 310, clicksDeltaPct: 12, impressions: 9800 },
      sources: [
        { label: "Buscadores (Google y otros)", visits: 610, deltaPct: 11 },
        { label: "Instagram", visits: 140, deltaPct: 9 },
        { label: "WhatsApp", visits: 55, deltaPct: 18 },
        { label: "LinkedIn", visits: 85, deltaPct: 30 },
        { label: "TikTok", visits: 40, deltaPct: null },
        { label: "Facebook", visits: 25, deltaPct: -5 },
        { label: "Otras redes", visits: 10, deltaPct: 0 },
        { label: "Directo o sin identificar", visits: 210, deltaPct: -4 },
        { label: "Otros sitios", visits: 90, deltaPct: 20 },
      ],
      ai: { visits: 30, deltaPct: null },
      queries: [{ query: "café de especialidad", clicks: 64 }, { query: "tostadores en bogotá", clicks: 41 }, { query: "café aurora", clicks: 33 }],
      topPages: [
        { label: "Inicio", visits: 480 },
        { label: "Servicios", visits: 210 },
        { label: "Contacto", visits: 95 },
      ],
      summaryLine: "Semana estable, con más llegada desde Google y LinkedIn.",
      dataThrough: "8 de nov",
    }),
    manual: buildClientReportEmail({ ...base, periodLabel: "últimos 30 días", summaryLine: "Mejoró la velocidad en el móvil y no hay incidencias abiertas.", facts: ["**Velocidad:** rendimiento medio de tus páginas, 84 sobre 100.", "**Visitas:** 5.380 (+7 %); el origen que más aporta: Google.", "**Google:** 1.390 clics y 41.800 veces que apareció tu sitio."] }),
  };

  const only = opt("solo")?.split(",").map((s) => s.trim());
  const names = Object.keys(all).filter((n) => !only || only.includes(n));
  if (names.length === 0) {
    console.error("--solo no coincide con ningún correo (bienvenida, mensual, semanal, manual).");
    process.exit(1);
  }

  if (dry) {
    mkdirSync(dry, { recursive: true });
    for (const n of names) {
      const mail = all[n]!;
      writeFileSync(join(dry, `${n}.html`), `<!doctype html><meta charset="utf-8"><title>${mail.subject}</title><body style="margin:0;padding:16px;background:#f3f4f6">${mail.html}</body>`);
      writeFileSync(join(dry, `${n}.txt`), `Asunto: ${mail.subject}\n\n${mail.text}\n`);
    }
    console.log(`Escribí ${names.length} correo(s) en ${dry}`);
  } else {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const mailer = createMailer({
      host: process.env.SMTP_HOST ?? "localhost",
      port,
      user: process.env.SMTP_USER || undefined,
      pass: process.env.SMTP_PASS || undefined,
      from: process.env.EMAIL_FROM ?? "Gustavo Amarista <no-reply@localhost>",
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    });
    const cc = opt("cc")?.split(",").map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const mail = all[n]!;
      await mailer.send({ to: to!, ...senderMailFields(sender), ...(cc && cc.length > 0 ? { cc } : {}), subject: `[PRUEBA] ${mail.subject}`, text: mail.text, html: mail.html });
      console.log(`Enviado: ${n} → ${to}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
