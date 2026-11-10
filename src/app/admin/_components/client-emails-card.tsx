import { formatDate } from "@/lib/audit-format";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { Field, SelectField } from "@/lib/ui/components/field";
import { monthLabelOf } from "@/server/domain/client-reports";
import type { EmailsPanel } from "@/server/services/client-reports";
import {
  addProjectActionAction,
  confirmServerCheckAction,
  removeProjectActionAction,
  sendReportTestAction,
} from "@/app/admin/clientes/actions";

const KIND_LABEL = { weekly: "Semanal", monthly: "Mensual" } as const;
const STATUS: Record<string, { label: string; tone: "ok" | "danger" | "neutral" }> = {
  sent: { label: "Enviado", tone: "ok" },
  failed: { label: "No se envió", tone: "danger" },
  skipped: { label: "Omitido", tone: "neutral" },
};

type Props = {
  projectId: string;
  panel: EmailsPanel;
  includesServer: boolean;
  /** Para sugerir la fecha de hoy en el formulario. */
  today: string;
  clientHref: string;
};

/** Registro de actuaciones, revisión del servidor, pruebas con datos reales e historial de los correos automáticos. */
export function ClientEmailsCard({ projectId, panel, includesServer, today, clientHref }: Props) {
  const months = [panel.months.previous, panel.months.current];
  return (
    <Card
      title="Correos al cliente"
      description="El semanal («Tu semana en la web») y el mensual («Estado general») se encienden en la ficha del cliente. Aquí anotas lo que atiendes, confirmas la revisión del servidor y pruebas cómo quedan con datos reales."
    >
      <p className="flex flex-wrap items-center gap-2 text-ink">
        <Badge tone={panel.weekly ? "ok" : "neutral"}>Semanal {panel.weekly ? "encendido" : "apagado"}</Badge>
        <Badge tone={panel.monthly ? "ok" : "neutral"}>Mensual {panel.monthly ? "encendido" : "apagado"}</Badge>
        <a href={clientHref} className="text-[15px] text-link underline">
          Cambiar en la ficha del cliente
        </a>
      </p>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Lo que atendiste</h3>
        <p className="text-[15px] leading-5 text-ink-muted">Una línea por cosa hecha (una actualización, un ajuste, una corrección). Sale en «Lo que atendimos» del correo del mes en que ocurrió. Si no anotas nada, el correo dice que no hizo falta intervenir.</p>
        <ActionForm action={addProjectActionAction.bind(null, projectId)} submitLabel="Anotar" pendingLabel="Guardando…" variant="secondary" resetOnSuccess>
          <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
            <Field label="Fecha" id="date" type="date" defaultValue={today} max={today} />
            <Field label="Qué hiciste" id="text" required minLength={3} maxLength={240} autoComplete="off" placeholder="Actualicé el plugin de formularios a su última versión." />
          </div>
        </ActionForm>
        {panel.actions.length > 0 ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {panel.actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 break-words text-ink">
                  <span className="font-mono text-[15px] text-ink-muted">{a.happenedOn}</span> · {a.text}
                </span>
                <ActionForm action={removeProjectActionAction.bind(null, projectId, a.id)} submitLabel="Borrar" pendingLabel="Borrando…" variant="ghost" />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {includesServer ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Revisión del servidor</h3>
          <p className="text-[15px] leading-5 text-ink-muted">
            Hoy esa supervisión es manual, así que el sistema no puede saberla. El correo mensual solo dice «Servidor y servicios: supervisados, sin incidencias» si confirmas aquí que lo revisaste ese mes.
            {panel.checkedMonths.length > 0 ? ` Confirmado: ${panel.checkedMonths.map(monthLabelOf).join(", ")}.` : " Todavía no hay meses confirmados."}
          </p>
          <ActionForm action={confirmServerCheckAction.bind(null, projectId)} submitLabel="Confirmo que revisé el servidor" pendingLabel="Guardando…" variant="secondary" className="max-w-md">
            <SelectField label="Mes" id="month" defaultValue={panel.months.previous}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabelOf(m)} {m.slice(0, 4)}
                  {panel.checkedMonths.includes(m) ? " (ya confirmado)" : ""}
                </option>
              ))}
            </SelectField>
          </ActionForm>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Probar con datos reales</h3>
        <p className="text-[15px] leading-5 text-ink-muted">Te llega a tu correo de administrador, con los datos de este proyecto del último periodo completo. No se envía al cliente ni cuenta como el envío del periodo.</p>
        <div className="flex flex-wrap gap-4">
          <ActionForm action={sendReportTestAction.bind(null, "weekly", projectId)} submitLabel="Enviarme el semanal de prueba" pendingLabel="Enviando…" variant="secondary" />
          <ActionForm action={sendReportTestAction.bind(null, "monthly", projectId)} submitLabel="Enviarme el mensual de prueba" pendingLabel="Enviando…" variant="secondary" />
        </div>
      </div>

      {panel.sends.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Últimos envíos automáticos</h3>
          <ul className="divide-y divide-border rounded-sm border border-border">
            {panel.sends.map((s) => (
              <li key={`${s.kind}-${s.periodKey}`} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS[s.status]?.tone ?? "neutral"}>{STATUS[s.status]?.label ?? s.status}</Badge>
                  <Badge>{KIND_LABEL[s.kind]}</Badge>
                  <span className="text-ink">
                    {s.kind === "monthly" ? `${monthLabelOf(s.periodKey)} ${s.periodKey.slice(0, 4)}` : s.periodKey}
                  </span>
                  <span className="text-[15px] text-ink-muted">{formatDate(s.sentAt)}</span>
                </div>
                {s.detail ? <p className="text-[15px] leading-5 text-ink-muted break-words">{s.detail}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
