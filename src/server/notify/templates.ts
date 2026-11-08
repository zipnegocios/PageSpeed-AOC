import { EMAIL, EMAIL_TEXT_SIGNATURE, emailBrandBand, emailButton, emailFooter } from "./email-theme";
import { PROFILE_TEXT, METRIC_TEXT } from "./labels";

export type DigestItem = {
  kind: "threshold" | "audit_failure";
  /** "new" = primera vez que se avisa; "reminder" = sigue abierta. */
  status: "new" | "reminder";
  routePath: string;
  profile: "mobile" | "desktop";
  metric: "performance" | "seo" | "accessibility" | "best_practices" | null;
  value: number | null;
  threshold: number | null;
  errorCode: string | null;
  openedAt: Date;
  reminderCount: number;
  auditId: string | null;
};

export type DigestInput = {
  projectName: string;
  clientName: string;
  projectUrl: string;
  /** Base de enlaces a auditorías, p. ej. https://app/admin/auditorias */
  auditsBase: string;
  items: DigestItem[];
  now: Date;
};

export type DigestEmail = {
  type: "initial" | "reminder" | "failure";
  subject: string;
  text: string;
  html: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (d: Date) =>
  `${new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d)} UTC`;

/** Qué pasa, sin la ruta: "SEO 69 (mínimo 90)" o "la auditoría falla (TIMEOUT)". */
export function describeCondition(i: DigestItem): string {
  if (i.kind === "audit_failure") return `la auditoría falla${i.errorCode ? ` (${i.errorCode})` : ""}`;
  return `${METRIC_TEXT[i.metric!]} ${i.value ?? "—"} (mínimo ${i.threshold ?? "—"})`;
}

export function describeItem(i: DigestItem): string {
  return `${i.routePath} · ${PROFILE_TEXT[i.profile]}: ${describeCondition(i)}`;
}

/** Tipo del correo según lo que contiene: lo nuevo manda sobre los recordatorios. */
export function digestType(items: DigestItem[]): DigestEmail["type"] {
  if (items.some((i) => i.status === "new" && i.kind === "threshold")) return "initial";
  if (items.some((i) => i.status === "new")) return "failure";
  return "reminder";
}

/** Un correo por proyecto: agrupa en secciones lo nuevo, los fallos y lo que sigue abierto. */
export function buildDigestEmail(input: DigestInput): DigestEmail {
  const type = digestType(input.items);
  const news = input.items.filter((i) => i.status === "new" && i.kind === "threshold");
  const failures = input.items.filter((i) => i.status === "new" && i.kind === "audit_failure");
  const reminders = input.items.filter((i) => i.status === "reminder");
  const n = input.items.length;

  const subject =
    type === "reminder"
      ? `Recordatorio: ${input.projectName} sigue con ${n} ${n === 1 ? "alerta abierta" : "alertas abiertas"}`
      : type === "failure"
        ? `Falla de auditoría en ${input.projectName}`
        : `${n === 1 ? "Alerta" : "Alertas"} en ${input.projectName}: ${n} ${n === 1 ? "métrica bajo el umbral" : "puntos bajo el umbral"}`;

  const sections: Array<[string, DigestItem[]]> = [
    ["Métricas bajo el umbral", news],
    ["Auditorías que fallan", failures],
    ["Siguen abiertas", reminders],
  ];

  const textLines = [`${input.clientName} · ${input.projectName}`, ""];
  const htmlParts: string[] = [];
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    textLines.push(title.toUpperCase());
    for (const i of items) {
      const since = i.status === "reminder" ? ` — abierta desde ${fmtDate(i.openedAt)}, recordatorio n.º ${i.reminderCount + 1}` : "";
      textLines.push(`- ${describeItem(i)}${since}`);
    }
    textLines.push("");
    htmlParts.push(
      `<h2 style="font-size:16px;margin:20px 0 8px;color:${EMAIL.ink}">${esc(title)}</h2><ul style="padding-left:18px;margin:0">` +
        items
          .map((i) => {
            const link = i.auditId ? ` <a href="${esc(`${input.auditsBase}/${i.auditId}`)}" style="color:${EMAIL.link}">ver auditoría</a>` : "";
            const since = i.status === "reminder" ? ` <span style="color:${EMAIL.muted}">(abierta desde ${esc(fmtDate(i.openedAt))})</span>` : "";
            return `<li style="margin:4px 0">${esc(describeItem(i))}${since}${link}</li>`;
          })
          .join("") +
        "</ul>",
    );
  }
  textLines.push(`Abrir el proyecto: ${input.projectUrl}`, "", ...EMAIL_TEXT_SIGNATURE);

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};max-width:560px">` +
    emailBrandBand(input.projectUrl) +
    `<h1 style="font-size:20px;margin:16px 0 0">${esc(input.projectName)}</h1>` +
    `<p style="margin:2px 0 0;color:${EMAIL.muted}">${esc(input.clientName)}</p>` +
    htmlParts.join("") +
    `<p style="margin:24px 0 0">${emailButton(esc(input.projectUrl), "Abrir el proyecto")}</p>` +
    emailFooter() +
    `</div>`;

  return { type, subject, text: textLines.join("\n"), html };
}
