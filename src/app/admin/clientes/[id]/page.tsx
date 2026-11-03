import type { Metadata } from "next";
import Link from "next/link";
import { appUrl, orNotFound } from "@/lib/not-found";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CopyButton } from "@/lib/ui/components/copy-button";
import { Field, SelectField, TextareaField } from "@/lib/ui/components/field";
import { getClient } from "@/server/services/clients";
import { listProjects } from "@/server/services/projects";
import { AdminShell } from "../../_components/admin-shell";
import {
  archiveClientAction,
  createProjectAction,
  rotateMagicTokenAction,
  setClientStatusAction,
  updateClientAction,
} from "../actions";

export const metadata: Metadata = { title: "Cliente · AOC PageSpeed", robots: { index: false, follow: false } };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  const { id } = await params;
  const client = await orNotFound(getClient(id));
  const projects = await listProjects(id);
  const portalUrl = `${appUrl()}/c/${client.magicToken}`;
  const active = client.status === "active";

  return (
    <AdminShell
      email={session.email}
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
                <Link href={`/admin/proyectos/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 hover:bg-surface-300">
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

      <Card title="Acceso del cliente" description="El cliente ve sus resultados con un link permanente, sin usuario ni contraseña.">
        <div className="flex flex-col gap-3">
          <label htmlFor="portal-link" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Link del portal
          </label>
          <input
            id="portal-link"
            readOnly
            value={portalUrl}
            className="min-h-11 w-full rounded-sm border border-border-strong bg-surface-100 px-3 font-mono text-[14px] text-ink"
          />
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton value={portalUrl} label="Copiar link" />
            <ActionForm action={rotateMagicTokenAction.bind(null, id)} submitLabel="Generar link nuevo" variant="ghost" pendingLabel="Generando…" />
          </div>
          <p className="text-[15px] leading-5 text-ink-muted">
            El cliente ve sus proyectos en producción, su evolución y puede descargar el informe en PDF o instalar el portal como app. Si generas un link nuevo, el anterior deja de funcionar al instante.
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
            El identificador <span className="font-mono">{client.slug}</span> no se puede cambiar: nombra la carpeta de este cliente en el almacenamiento.
          </p>
        </ActionForm>
      </Card>

      <Card title="Archivar cliente" description="Lo oculta del panel, detiene sus auditorías y desactiva su link del portal. No borra nada: lo encuentras en Archivados, donde puedes restaurarlo o eliminarlo para siempre.">
        <div>
          <ActionForm action={archiveClientAction.bind(null, id)} submitLabel="Archivar cliente" variant="secondary" pendingLabel="Archivando…" />
        </div>
      </Card>
    </AdminShell>
  );
}
