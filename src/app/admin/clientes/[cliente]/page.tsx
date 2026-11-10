import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/audit-format";
import { appUrl, orNotFound } from "@/lib/not-found";
import { clientPath, projectPath } from "@/lib/urls";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CopyButton } from "@/lib/ui/components/copy-button";
import { CheckboxField, Field, SelectField, TextareaField } from "@/lib/ui/components/field";
import { getClientByRef } from "@/server/services/clients";
import { listProjects } from "@/server/services/projects";
import { listResponsibles } from "@/server/services/client-sender";
import { ClientLogoUploader } from "@/app/admin/_components/client-logo-uploader";
import { logoInfo } from "@/server/domain/client-logo";
import { PinForms } from "@/app/admin/_components/pin-forms";
import { WelcomeForm } from "@/app/admin/_components/welcome-form";
import { formatCcContacts, siteLabel } from "@/server/domain/client-welcome";
import { readStoredPin } from "@/server/services/portal-pin";
import { RenameSlugForm } from "@/app/admin/_components/rename-slug-form";
import { AdminShell } from "@/app/admin/_components/admin-shell";
import {
  archiveClientAction,
  assignClientOwnerAction,
  createProjectAction,
  renameClientSlugAction,
  generateAndEmailPinAction,
  generatePinAction,
  sendWelcomeAction,
  setClientStatusAction,
  setReportPreferencesAction,
  updateClientAction,
} from "@/app/admin/clientes/actions";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Cliente"), robots: { index: false, follow: false } };

export default async function ClientPage({ params }: { params: Promise<{ cliente: string }> }) {
  await verifySession();
  const { cliente } = await params;
  const client = await orNotFound(getClientByRef(cliente));
  // Un enlace antiguo con UUID se lleva a la dirección legible.
  if (cliente !== client.slug) redirect(clientPath(client.slug));
  const id = client.id;
  const projects = await listProjects(id);
  const responsibles = await listResponsibles();
  // Sin responsable (clientes anteriores) firma la cuenta propietaria.
  const responsible = responsibles.find((r) => r.id === client.ownerId) ?? responsibles.find((r) => r.role === "owner") ?? responsibles[0] ?? null;
  const fixedUrl = `${appUrl()}/c/${client.slug}`;
  const currentPin = readStoredPin(client);
  const active = client.status === "active";
  const logo = logoInfo(client);
  const productionProjects = projects.filter((p) => p.phase === "production");

  return (
    <AdminShell
     
      title={client.name}
      subtitle={<span className="font-mono text-[15px]">{client.slug}</span>}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: "Clientes", href: "/admin/clientes" },
      ]}
      actions={<Badge tone={active ? "ok" : "danger"}>{active ? "Activo" : "Suspendido"}</Badge>}
    >
      <Card title="Proyectos" description="Cada proyecto es un sitio que se audita.">
        {projects.length === 0 ? (
          <p className="text-ink-muted">Este cliente aún no tiene proyectos.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={projectPath(client.slug, p.slug)} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 hover:bg-surface-300">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[19px] font-semibold break-words text-ink">{p.name}</span>
                    <span className="text-[15px] break-all text-ink-muted">
                      {p.baseUrl} · {p.routeCount} {p.routeCount === 1 ? "ruta" : "rutas"}
                    </span>
                  </span>
                  <Badge tone={p.phase === "production" ? "primary" : "neutral"}>{p.phase === "production" ? "Producción" : "Desarrollo"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <details open={projects.length === 0} className="rounded-sm border border-border p-4">
          <summary className="cursor-pointer text-[19px] font-semibold text-ink">Nuevo proyecto</summary>
          <ActionForm action={createProjectAction.bind(null, id)} submitLabel="Crear proyecto" pendingLabel="Creando…" className="mt-4">
            <Field label="Nombre" id="name" required maxLength={120} autoComplete="off" />
            <Field label="URL del sitio" id="baseUrl" type="url" required placeholder="https://www.ejemplo.com" autoComplete="off" hint="Solo se guarda el dominio; las páginas se agregan como rutas." />
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Fase" id="phase" defaultValue="development" hint="Producción si el sitio ya está publicado.">
                <option value="development">Desarrollo</option>
                <option value="production">Producción</option>
              </SelectField>
              <SelectField label="Frecuencia en producción" id="auditFrequency" defaultValue="weekly">
                <option value="weekly">Semanal (estándar)</option>
                <option value="daily">Diaria (prioritaria)</option>
              </SelectField>
            </div>
            <Field label="URL del sitemap (opcional)" id="sitemapUrl" type="url" placeholder="Por defecto: /sitemap.xml" autoComplete="off" />
          </ActionForm>
        </details>
      </Card>

      <Card title="Logotipo" description="Dos versiones del logotipo del cliente. Se ven en su portal, en el panel y en los informes en PDF.">
        <ClientLogoUploader clientId={id} name={client.name} icon={Boolean(logo?.icon)} full={Boolean(logo?.full)} bg={client.logoBg} v={logo?.v ?? 0} />
      </Card>

      <Card
        title="Responsable"
        description="Quien atiende a este cliente. Firma todos los correos que recibe, le llegan las alertas de sus proyectos y es el contacto de su portal. Quien crea el cliente queda como responsable."
      >
        <ActionForm action={assignClientOwnerAction.bind(null, id)} submitLabel="Cambiar responsable" pendingLabel="Guardando…" variant="secondary" className="max-w-xl">
          <SelectField label="Responsable" id="ownerId" defaultValue={responsible?.id ?? ""}>
            {responsibles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.name !== r.email ? ` · ${r.email}` : ""}
                {r.role === "owner" ? " (propietario)" : ""}
              </option>
            ))}
          </SelectField>
        </ActionForm>
        {responsible ? (
          <div className="flex flex-col gap-2 text-[15px] leading-5 text-ink-muted">
            <p>
              Los correos al cliente salen como <strong className="text-ink">{responsible.name}</strong>
              {responsible.phone || responsible.role === "owner" ? "" : ", sin teléfono en el pie"}; las respuestas llegan a {responsible.email}.
            </p>
            {!responsible.hasName ? <p className="text-ink">Esta persona no tiene nombre en su perfil: el correo saldría firmado con su dirección. Pídele que lo complete en «Mi perfil».</p> : null}
            {!responsible.phone && responsible.role !== "owner" ? <p className="text-ink">Esta persona no tiene WhatsApp en su perfil: el pie del correo no mostrará teléfono. Se agrega en «Mi perfil».</p> : null}
          </div>
        ) : null}
      </Card>

      <Card
        title="Bienvenida"
        description="Un solo correo que explica el servicio y da el acceso al portal, para el contacto principal y su equipo en copia."
      >
        {client.welcomeSentAt ? (
          <p className="text-ink">
            <Badge tone="ok">Enviada</Badge> <span className="text-[15px] text-ink-muted">El {formatDate(client.welcomeSentAt)}. Puedes reenviarla.</span>
          </p>
        ) : null}
        {!client.contactEmail ? (
          <p className="text-ink-muted">Agrega el correo de contacto del cliente (abajo, en sus datos) para poder enviarle la bienvenida.</p>
        ) : productionProjects.length === 0 ? (
          <p className="text-ink-muted">Pon al menos un proyecto en producción: el portal del cliente solo muestra los proyectos en producción.</p>
        ) : (
          <WelcomeForm
            action={sendWelcomeAction.bind(null, id)}
            contactName={client.contactName}
            contactEmail={client.contactEmail}
            initialCc={formatCcContacts(client.ccContacts)}
            projects={productionProjects.map((p) => ({
              id: p.id,
              name: p.name,
              site: siteLabel(p.baseUrl),
              kind: p.kind,
              techLabel: p.techLabel ?? "",
              includesServer: p.includesServer,
            }))}
          />
        )}
      </Card>

      <Card
        title="Correos automáticos"
        description="Dos correos con la marca de zipnegocios, para el contacto principal y su equipo en copia. Están apagados hasta que los enciendas."
      >
        <ActionForm action={setReportPreferencesAction.bind(null, id)} submitLabel="Guardar" pendingLabel="Guardando…" variant="secondary">
          <CheckboxField
            label="Semanal: «Tu semana en la web»"
            id="weekly"
            defaultChecked={client.reportWeekly}
            hint="Lunes, con las visitas de la semana anterior y de dónde llegaron. Solo sale si GA4 está conectado y el tráfico es visible para el cliente. Si los datos no están completos, espera hasta el miércoles; pasado eso, se omite esa semana."
          />
          <CheckboxField
            label="Mensual: «Estado general»"
            id="monthly"
            defaultChecked={client.reportMonthly}
            hint="El primer lunes del mes, con las auditorías del mes anterior, lo que atendiste y lo que sigue. No sale si ese mes no hubo auditorías."
          />
        </ActionForm>
        <p className="text-[15px] leading-5 text-ink-muted">
          Se envía un correo por cada proyecto en producción. Para ver cómo queda con datos reales, usa «Probar con datos reales» en la ficha del proyecto: te llega solo a ti. Los envíos quedan en el historial del proyecto y en la bitácora de correos.
        </p>
      </Card>

      <Card title="Acceso del cliente" description="El cliente entra con un link fijo y un PIN de 6 dígitos, sin usuario ni contraseña.">
        <div className="flex flex-col gap-3">
          <label htmlFor="portal-link-fixed" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Link del portal
          </label>
          <input
            id="portal-link-fixed"
            readOnly
            value={fixedUrl}
            className="min-h-11 w-full rounded-sm border border-border-strong bg-surface-100 px-3 font-mono text-[14px] text-ink"
          />
          <div>
            <CopyButton value={fixedUrl} label="Copiar link" />
          </div>
          <p className="text-[15px] leading-5 text-ink-muted">
            Lleva el identificador del cliente y no cambia mientras no lo cambies. Al abrirlo, pide el PIN. Con el PIN, el cliente ve sus proyectos en producción, su evolución y el informe en PDF, y puede instalarlo como app.
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-ink">
            PIN:{" "}
            {client.pinHash ? <Badge tone="ok">Con PIN</Badge> : <Badge tone="neutral">Sin PIN</Badge>}{" "}
            <span className="text-[15px] text-ink-muted">
              {client.pinHash && client.pinUpdatedAt ? `Generado el ${formatDate(client.pinUpdatedAt)}.` : "Mientras no haya PIN, el cliente no puede entrar (él mismo puede pedir uno a su correo)."}
            </span>
          </p>
          {client.pinHash ? (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">PIN actual</span>
              {currentPin ? (
                <>
                  <code id="pin-actual" className="block w-fit rounded-sm bg-surface-300 px-4 py-2 font-mono text-[32px] tracking-[0.3em] text-ink select-all">{currentPin}</code>
                  <div>
                    <CopyButton value={currentPin} label="Copiar PIN" />
                  </div>
                </>
              ) : (
                <p className="text-[15px] leading-5 text-ink-muted">No disponible: genera un PIN nuevo para verlo aquí.</p>
              )}
            </div>
          ) : null}
          <PinForms generate={generatePinAction.bind(null, id)} generateAndEmail={generateAndEmailPinAction.bind(null, id)} canEmail={Boolean(client.contactEmail)} />
          <p className="text-[15px] leading-5 text-ink-muted">
            Se muestra aquí siempre el último PIN generado (guardado cifrado con AUTH_ENCRYPTION_KEY). Generar uno nuevo anula el anterior y cierra las sesiones abiertas del cliente. El cliente también puede pedir un PIN nuevo desde el portal: le llega al correo de contacto{client.contactEmail ? ` (${client.contactEmail})` : ", que aún no tiene registrado"}.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-ink">
            Estado: <strong>{active ? "Activo" : "Suspendido"}</strong>.{" "}
            <span className="text-ink-muted">
              {active
                ? "El cliente ve sus resultados."
                : "El cliente verá una pantalla para renovar el servicio en lugar de sus resultados."}
            </span>
          </p>
          <ActionForm
            action={setClientStatusAction.bind(null, id, active ? "suspended" : "active")}
            submitLabel={active ? "Suspender cliente" : "Reactivar cliente"}
            variant={active ? "secondary" : "primary"}
          />
        </div>
      </Card>

      <Card title="Datos del cliente">
        <ActionForm action={updateClientAction.bind(null, id)} submitLabel="Guardar datos">
          <Field label="Nombre" id="name" required maxLength={120} defaultValue={client.name} autoComplete="off" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Persona de contacto" id="contactName" maxLength={120} defaultValue={client.contactName ?? ""} autoComplete="off" />
            <Field label="Correo de contacto" id="contactEmail" type="email" defaultValue={client.contactEmail ?? ""} autoComplete="off" />
            <Field label="Teléfono / WhatsApp" id="contactPhone" type="tel" defaultValue={client.contactPhone ?? ""} autoComplete="off" />
          </div>
          <TextareaField label="Notas internas" id="notes" maxLength={2000} defaultValue={client.notes ?? ""} />
          <p className="text-[15px] leading-5 text-ink-muted">
            Para cambiar el identificador <span className="font-mono">{client.slug}</span> usa el bloque de abajo.
          </p>
        </ActionForm>
        <RenameSlugForm action={renameClientSlugAction.bind(null, id)} current={client.slug} what="cliente" aliases={client.slugAliases} />
      </Card>

      <Card title="Archivar cliente" description="Lo oculta del panel, detiene sus auditorías y desactiva su link del portal. No borra nada: lo encuentras en Archivados, donde puedes restaurarlo o eliminarlo para siempre.">
        <div>
          <ActionForm action={archiveClientAction.bind(null, id)} submitLabel="Archivar cliente" variant="secondary" pendingLabel="Archivando…" />
        </div>
      </Card>
    </AdminShell>
  );
}
