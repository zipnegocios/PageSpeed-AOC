import type { Metadata } from "next";
import { orNotFound } from "@/lib/not-found";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CheckboxField, Field, SelectField } from "@/lib/ui/components/field";
import { getProject } from "@/server/services/projects";
import { listRoutes } from "@/server/services/routes";
import { getThresholds } from "@/server/services/thresholds";
import { AdminShell } from "../../_components/admin-shell";
import {
  addRouteAction,
  archiveProjectAction,
  discoverRoutesAction,
  importRoutesAction,
  removeRouteAction,
  setPhaseAction,
  setThresholdsAction,
  toggleRouteAction,
  updateProjectAction,
} from "../actions";
import { SitemapImporter } from "./sitemap-importer";

export const metadata: Metadata = { title: "Proyecto · AOC PageSpeed", robots: { index: false, follow: false } };

const METRIC_LABELS = {
  performance: "Rendimiento",
  seo: "SEO",
  accessibility: "Accesibilidad",
  best_practices: "Buenas prácticas",
} as const;

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  const { id } = await params;
  const project = await orNotFound(getProject(id));
  const [routes, thresholds] = await Promise.all([listRoutes(id), getThresholds(id)]);
  const production = project.phase === "production";

  return (
    <AdminShell
      email={session.email}
      title={project.name}
      subtitle={<span className="break-all">{project.baseUrl}</span>}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: "Clientes", href: "/admin/clientes" },
        { label: project.clientName, href: `/admin/clientes/${project.clientId}` },
      ]}
      actions={<Badge tone={production ? "primary" : "neutral"}>{production ? "Producción" : "Desarrollo"}</Badge>}
    >
      <Card
        title="Fase del proyecto"
        description={
          production
            ? "Producción: se audita en móvil y escritorio con la frecuencia elegida y las alertas están activas."
            : "Desarrollo: se audita una página a la vez bajo demanda y no se envían alertas."
        }
      >
        <ActionForm action={setPhaseAction.bind(null, id)} submitLabel="Cambiar fase" variant="secondary" className="max-w-md">
          <SelectField label="Fase" id="phase" defaultValue={project.phase} hint="Pasar a desarrollo silencia las alertas abiertas. El agendado automático de auditorías llega con el worker.">
            <option value="development">Desarrollo</option>
            <option value="production">Producción</option>
          </SelectField>
        </ActionForm>
      </Card>

      <Card title="Rutas" description="Las rutas marcadas como monitoreadas entran a las auditorías programadas de producción.">
        {routes.length === 0 ? (
          <p className="text-ink-muted">Aún no hay rutas. Agrega la portada o busca las páginas en el sitemap.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {routes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-[15px] break-all text-ink">{r.path}</span>
                  <span className="flex flex-wrap gap-2 text-[14px] text-ink-muted">
                    {r.label ? <span>{r.label}</span> : null}
                    <span>{r.source === "sitemap" ? "Desde sitemap" : "Manual"}</span>
                    {r.requiresAuth ? <span>Requiere login</span> : null}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.monitored ? "ok" : "neutral"}>{r.monitored ? "Monitoreada" : "Inactiva"}</Badge>
                  <ActionForm action={toggleRouteAction.bind(null, id, r.id, !r.monitored)} submitLabel={r.monitored ? "Desactivar" : "Activar"} variant="ghost" pendingLabel="…" />
                  <ActionForm action={removeRouteAction.bind(null, id, r.id)} submitLabel="Borrar" variant="ghost" pendingLabel="…" />
                </span>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-sm border border-border p-4">
          <summary className="cursor-pointer text-[19px] font-semibold text-ink">Agregar una ruta</summary>
          <ActionForm action={addRouteAction.bind(null, id)} submitLabel="Agregar ruta" pendingLabel="Agregando…" resetOnSuccess className="mt-4">
            <Field label="Ruta o URL" id="path" required placeholder="/contacto" autoComplete="off" hint="Puedes pegar la URL completa; se guarda solo la ruta." />
            <Field label="Etiqueta (opcional)" id="label" maxLength={120} autoComplete="off" />
            <CheckboxField label="Requiere iniciar sesión" id="requiresAuth" hint="Para páginas privadas; el login de prueba se configura en un milestone posterior." />
          </ActionForm>
        </details>

        <details className="rounded-sm border border-border p-4">
          <summary className="cursor-pointer text-[19px] font-semibold text-ink">Descubrir desde el sitemap</summary>
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-[15px] leading-5 text-ink-muted">
              Se lee {project.sitemapUrl ?? `${project.baseUrl}/sitemap.xml`}.
              {project.lastSitemapScanAt ? ` Última búsqueda: ${dateFormat.format(project.lastSitemapScanAt)} UTC.` : ""}
            </p>
            <SitemapImporter discover={discoverRoutesAction.bind(null, id)} importRoutes={importRoutesAction.bind(null, id)} />
          </div>
        </details>
      </Card>

      <Card title="Umbrales de alerta" description="Puntuación mínima aceptable, por métrica. Si baja de aquí, se abre una alerta (solo en producción).">
        <ActionForm action={setThresholdsAction.bind(null, id)} submitLabel="Guardar umbrales">
          <div className="grid gap-4 sm:grid-cols-2">
            {thresholds.map((t) => (
              <div key={t.metric} className="flex flex-col gap-1 rounded-sm border border-border p-3">
                <Field
                  label={METRIC_LABELS[t.metric]}
                  id={`score_${t.metric}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  required
                  defaultValue={t.minScore}
                  hint="De 0 a 100."
                />
                <CheckboxField label="Alertar" id={`enabled_${t.metric}`} defaultChecked={t.enabled} />
              </div>
            ))}
          </div>
        </ActionForm>
      </Card>

      <Card title="Ajustes del proyecto">
        <ActionForm action={updateProjectAction.bind(null, id)} submitLabel="Guardar ajustes">
          <Field label="Nombre" id="name" required maxLength={120} defaultValue={project.name} autoComplete="off" />
          <Field label="URL del sitio" id="baseUrl" type="url" required defaultValue={project.baseUrl} autoComplete="off" />
          <SelectField label="Frecuencia en producción" id="auditFrequency" defaultValue={project.auditFrequency}>
            <option value="weekly">Semanal (estándar)</option>
            <option value="daily">Diaria (prioritaria)</option>
          </SelectField>
          <Field label="URL del sitemap (opcional)" id="sitemapUrl" type="url" defaultValue={project.sitemapUrl ?? ""} placeholder="Por defecto: /sitemap.xml" autoComplete="off" />
          <div className="flex flex-col gap-2">
            <label htmlFor="allowedHosts" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Hosts permitidos
            </label>
            <textarea
              id="allowedHosts"
              name="allowedHosts"
              rows={3}
              defaultValue={project.allowedHosts.join("\n")}
              className="rounded-sm border border-border-strong bg-surface-100 px-3 py-2 font-mono text-[15px] text-ink"
            />
            <p className="text-[15px] leading-5 text-ink-muted">
              Solo estos hosts pueden auditarse o leerse desde el sitemap. Uno por línea; admite <span className="font-mono">*.ejemplo.com</span>. El host del sitio siempre se incluye.
            </p>
          </div>
        </ActionForm>
      </Card>

      <Card title="Archivar proyecto" description="Lo oculta del panel y conserva su historial.">
        <div>
          <ActionForm action={archiveProjectAction.bind(null, id, project.clientId)} submitLabel="Archivar proyecto" variant="secondary" pendingLabel="Archivando…" />
        </div>
      </Card>
    </AdminShell>
  );
}
