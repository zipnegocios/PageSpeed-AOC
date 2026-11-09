import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { orNotFound } from "@/lib/not-found";
import { clientPath, projectPath } from "@/lib/urls";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Alert } from "@/lib/ui/components/alert";
import { Card } from "@/lib/ui/components/card";
import { CheckboxField, Field, SelectField, TextareaField } from "@/lib/ui/components/field";
import { getWhatsappLinkForProject, listOpenAlerts, listRecentNotifications } from "@/server/services/alerts";
import { listAudits } from "@/server/services/audits";
import { authKeyStatus, getProjectAuthSummary } from "@/server/services/project-auth";
import { getPageAudits } from "@/server/services/pages";
import { getNextScheduledRun, getProjectByRef } from "@/server/services/projects";
import { getClient } from "@/server/services/clients";
import { listRoutes } from "@/server/services/routes";
import { getThresholds } from "@/server/services/thresholds";
import { formatDate, formatDuration, formatSeconds, isPending, PROFILE_LABEL } from "@/lib/audit-format";
import { Score } from "@/lib/ui/components/score";
import Link from "next/link";
import { AdminShell } from "@/app/admin/_components/admin-shell";
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { FieldDataCard } from "@/app/_components/field-data-card";
import { HistoryPanel, type HistorySearch } from "@/app/_components/history-panel";
import { AlertList, NotificationList } from "@/app/admin/_components/alert-list";
import { AuditStatusBadge } from "@/app/admin/_components/audit-badge";
import {
  addRouteAction,
  archiveProjectAction,
  discoverRoutesAction,
  importRoutesAction,
  removeRouteAction,
  renameProjectSlugAction,
  requestAuditAction,
  sendReportAction,
  clearAuthAction,
  refreshFieldDataAction,
  saveCookieAuthAction,
  saveFormAuthAction,
  toggleRouteAuthAction,
  setPhaseAction,
  setThresholdsAction,
  toggleRouteAction,
  updateProjectAction,
} from "@/app/admin/proyectos/actions";
import { PageAuditCard } from "@/app/admin/_components/page-audit-card";
import { RenameSlugForm } from "@/app/admin/_components/rename-slug-form";
import { SitemapImporter } from "./sitemap-importer";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Proyecto"), robots: { index: false, follow: false } };

const METRIC_LABELS = {
  performance: "Rendimiento",
  seo: "SEO",
  accessibility: "Accesibilidad",
  best_practices: "Buenas prácticas",
} as const;

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ cliente: string; proyecto: string }>; searchParams: Promise<HistorySearch> }) {
  const session = await verifySession();
  const { cliente, proyecto } = await params;
  const search = await searchParams;
  const project = await orNotFound(getProjectByRef(cliente, proyecto));
  // Un enlace antiguo con UUID se lleva a la dirección legible.
  if (cliente !== project.clientSlug || proyecto !== project.slug) redirect(projectPath(project.clientSlug, project.slug));
  const id = project.id;
  const base = projectPath(project.clientSlug, project.slug);
  const now = new Date();
  const [routes, thresholds, audits, pages, alerts, notifications, whatsappLink, authSummary] = await Promise.all([
    listRoutes(id),
    getThresholds(id),
    listAudits(id, 20),
    getPageAudits(id),
    listOpenAlerts(id),
    listRecentNotifications(5, id),
    getWhatsappLinkForProject(id),
    getProjectAuthSummary(id),
  ]);
  const authKey = authKeyStatus();
  const client = await getClient(project.clientId);
  const production = project.phase === "production";
  const nextRun = production ? await getNextScheduledRun(id) : null;

  return (
    <AdminShell
      email={session.email}
      title={project.name}
      subtitle={<span className="break-all">{project.baseUrl}</span>}
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: "Clientes", href: "/admin/clientes" },
        { label: project.clientName, href: clientPath(project.clientSlug) },
      ]}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`${base}/seo`} className="press inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 text-[17px] font-semibold text-ink hover:bg-surface-300">
            SEO y visibilidad
          </Link>
          <Badge tone={production ? "primary" : "neutral"}>{production ? "Producción" : "Desarrollo"}</Badge>
        </div>
      }
    >
      <section aria-labelledby="paginas-titulo" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="paginas-titulo" className="text-[24px] leading-7 font-semibold text-ink">
            Páginas
          </h2>
          <p className="text-[15px] leading-5 text-ink-muted">Cada página con su versión móvil y de escritorio: cambia de pestaña para compararlas. Toca una auditoría para abrirla. Se actualiza sola mientras haya auditorías pendientes.</p>
        </div>
        <AutoRefresh active={pages.some((p) => p.mobile.pending || p.desktop.pending) || audits.some((a) => isPending(a.status))} />
        {pages.length === 0 ? (
          <p className="text-ink-muted">Todavía no hay páginas para auditar. Agrega una ruta más abajo.</p>
        ) : (
          pages.map((pg) => <PageAuditCard key={pg.route.id} page={pg} projectId={id} now={now} />)
        )}
        <details className="hud rounded-lg p-4 md:p-5">
          <summary className="cursor-pointer text-[19px] font-semibold text-ink">Historial completo (cronológico)</summary>
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-[15px] leading-5 text-ink-muted">Las últimas 20 ejecuciones del proyecto, de todas las páginas y dispositivos mezcladas.</p>
            {audits.length === 0 ? (
              <p className="text-ink-muted">Todavía no hay auditorías. Usa el botón Auditar en una ruta.</p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-border">
                <table className="w-full min-w-[44rem] border-collapse text-left text-[15px]">
                  <thead className="bg-surface-300 text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Ruta</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2 text-right" title="Rendimiento">Rend.</th>
                      <th className="px-3 py-2 text-right">SEO</th>
                      <th className="px-3 py-2 text-right" title="Accesibilidad">Acces.</th>
                      <th className="px-3 py-2 text-right" title="Buenas prácticas">B. prác.</th>
                      <th className="px-3 py-2 text-right">LCP</th>
                      <th className="px-3 py-2">Cuándo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {audits.map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="px-3 py-2">
                          <Link href={`/admin/auditorias/${a.id}`} className="font-mono break-all text-link hover:underline">
                            {a.routePath}
                          </Link>
                          <div className="text-[14px] text-ink-muted">{PROFILE_LABEL[a.profile]}</div>
                        </td>
                        <td className="px-3 py-2">
                          <AuditStatusBadge audit={a} />
                          {a.attempts > 1 ? <div className="text-[14px] text-ink-muted">Intento {a.attempts}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-right"><Score value={a.scorePerformance} /></td>
                        <td className="px-3 py-2 text-right"><Score value={a.scoreSeo} /></td>
                        <td className="px-3 py-2 text-right"><Score value={a.scoreAccessibility} /></td>
                        <td className="px-3 py-2 text-right"><Score value={a.scoreBestPractices} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatSeconds(a.lcpMs)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDate(a.finishedAt ?? a.queuedAt)}
                          <div className="text-[14px] text-ink-muted">{formatDuration(a.durationMs)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      </section>

      <Card
        title="Fase del proyecto"
        description={
          production
            ? `Producción: se audita en móvil y escritorio con la frecuencia elegida y las alertas están activas. ${nextRun ? `Próxima auditoría programada: ${formatDate(nextRun)}.` : "Aún no tiene una próxima auditoría agendada; se corrige sola en unos minutos."}`
            : "Desarrollo: se audita una página a la vez bajo demanda y no se envían alertas."
        }
      >
        <ActionForm action={setPhaseAction.bind(null, id)} submitLabel="Cambiar fase" variant="secondary" className="max-w-md">
          <SelectField label="Fase" id="phase" defaultValue={project.phase} hint="Pasar a desarrollo silencia las alertas abiertas, retira el agendado y cancela las auditorías programadas pendientes.">
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
                    {r.requiresAuth ? <Badge>Requiere sesión</Badge> : null}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <ActionForm action={requestAuditAction.bind(null, id, r.id)} submitLabel="Auditar" variant="secondary" pendingLabel="Encolando…" className="flex-row flex-wrap items-center gap-2">
                    <select name="profile" aria-label="Perfil a auditar" defaultValue="both" className="min-h-11 rounded-sm border border-border-strong bg-surface-100 px-2 text-[17px] text-ink">
                      <option value="both">Móvil y escritorio</option>
                      <option value="mobile">Solo móvil</option>
                      <option value="desktop">Solo escritorio</option>
                    </select>
                  </ActionForm>
                  <Badge tone={r.monitored ? "ok" : "neutral"}>{r.monitored ? "Monitoreada" : "Inactiva"}</Badge>
                  <ActionForm action={toggleRouteAuthAction.bind(null, id, r.id, !r.requiresAuth)} submitLabel={r.requiresAuth ? "Sin sesión" : "Pedir sesión"} variant="ghost" pendingLabel="…" />
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
            <CheckboxField label="Requiere iniciar sesión" id="requiresAuth" hint="Para páginas privadas. El usuario de prueba se configura en «Acceso a páginas privadas», más abajo." />
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

      <Card
        title="Acceso a páginas privadas"
        description="Para auditar páginas que exigen iniciar sesión. Crea un usuario de prueba solo para esto; nunca uses una cuenta real de administración."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={authSummary.configured ? "ok" : "neutral"}>{authSummary.configured ? "Configurado" : "Sin configurar"}</Badge>
          {authSummary.configured && authSummary.unreadable ? (
            <span className="text-[15px] text-ink-muted">Hay un acceso guardado, pero no se puede leer con la clave actual.</span>
          ) : authSummary.configured && authSummary.strategy === "form" ? (
            <span className="text-[15px] break-all text-ink-muted">
              Formulario en <span className="font-mono">{authSummary.loginUrl}</span> con el usuario <strong className="text-ink">{authSummary.username}</strong>
            </span>
          ) : authSummary.configured && authSummary.strategy === "cookie" ? (
            <span className="text-[15px] text-ink-muted">
              Cookies: <span className="font-mono">{authSummary.cookieNames.join(", ")}</span>
            </span>
          ) : null}
        </div>
        {authKey !== "ok" ? (
          <Alert tone="danger">
            {authKey === "missing"
              ? "Falta AUTH_ENCRYPTION_KEY en el servicio web. Créala con «openssl rand -base64 32» y cárgala igual en el web y en el worker antes de guardar credenciales."
              : "AUTH_ENCRYPTION_KEY no es válida: debe ser de 32 bytes en base64 («openssl rand -base64 32»)."}
          </Alert>
        ) : (
          <>
            <details className="rounded-sm border border-border p-4">
              <summary className="cursor-pointer text-[19px] font-semibold text-ink">Formulario de inicio de sesión</summary>
              <ActionForm action={saveFormAuthAction.bind(null, id)} submitLabel="Guardar acceso" pendingLabel="Guardando…" resetOnSuccess className="mt-4 max-w-xl">
                <Field label="Página de inicio de sesión" id="loginUrl" required placeholder="/login" autoComplete="off" hint="Una ruta o una URL de un host permitido de este proyecto." />
                <Field label="Usuario de prueba" id="username" required autoComplete="off" />
                <Field label="Contraseña" id="password" type="password" required autoComplete="new-password" hint="Se guarda cifrada y no se vuelve a mostrar." />
                <details className="rounded-sm border border-border p-3">
                  <summary className="cursor-pointer text-[17px] font-semibold text-ink">Selectores (solo si el formulario es poco común)</summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <Field label="Campo de usuario" id="usernameSelector" autoComplete="off" placeholder='input[name="email"]' />
                    <Field label="Campo de contraseña" id="passwordSelector" autoComplete="off" placeholder='input[type="password"]' />
                    <Field label="Botón de enviar" id="submitSelector" autoComplete="off" placeholder='button[type="submit"]' />
                    <Field label="Elemento que confirma la sesión" id="successSelector" autoComplete="off" hint="Si lo indicas, el acceso se da por bueno cuando aparece. Si no, cuando desaparece el campo de contraseña." />
                  </div>
                </details>
              </ActionForm>
            </details>
            <details className="rounded-sm border border-border p-4">
              <summary className="cursor-pointer text-[19px] font-semibold text-ink">Cookies de sesión</summary>
              <ActionForm action={saveCookieAuthAction.bind(null, id)} submitLabel="Guardar cookies" pendingLabel="Guardando…" resetOnSuccess className="mt-4 max-w-xl">
                <TextareaField
                  label="Cookies (una por línea: nombre=valor)"
                  id="cookies"
                  required
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono [-webkit-text-security:disc]"
                  hint="Se guardan cifradas y no se vuelven a mostrar. Si caducan, las auditorías fallarán con AUTH_FAILED hasta que pegues unas nuevas."
                />
              </ActionForm>
            </details>
            {authSummary.configured ? <ActionForm action={clearAuthAction.bind(null, id)} submitLabel="Quitar acceso" pendingLabel="Quitando…" variant="ghost" /> : null}
          </>
        )}
      </Card>

      <Card
        title={`Alertas (${alerts.length})`}
        description={
          production
            ? "Se avisa por correo al abrirse y se recuerda cada 7 días mientras sigan abiertas. Al recuperarse se cierran solas."
            : "En desarrollo no se generan ni se envían alertas."
        }
      >
        {alerts.length === 0 ? (
          <p className="text-ink-muted">{production ? "No hay alertas abiertas en este proyecto." : "Sin alertas."}</p>
        ) : (
          <>
            <AlertList alerts={alerts} />
            <div>
              {whatsappLink ? (
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300"
                >
                  Avisar al cliente por WhatsApp
                </a>
              ) : (
                <p className="text-[15px] text-ink-muted">Agrega un teléfono de contacto al cliente para avisarle por WhatsApp.</p>
              )}
            </div>
          </>
        )}
        {notifications.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Últimos correos</h3>
            <NotificationList items={notifications} />
          </div>
        ) : null}
      </Card>

      <HistoryPanel projectId={id} basePath={base} search={search} allRoutes />

      <FieldDataCard
        projectId={id}
        basePath={base}
        search={search}
        audience="admin"
        allRoutes
        footer={<ActionForm action={refreshFieldDataAction.bind(null, id)} submitLabel="Actualizar datos reales" pendingLabel="Pidiendo…" variant="secondary" />}
      />

      <Card title="Informe" description="Resumen en PDF con el estado actual, los puntos por mejorar y la evolución del rendimiento.">
        <div className="flex flex-wrap gap-2">
          {([30, 90] as const).map((d) => (
            <a
              key={d}
              href={`/api/admin/projects/${id}/report?dias=${d}`}
              download
              className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300"
            >
              Descargar PDF · {d} días
            </a>
          ))}
        </div>
        {client.contactEmail ? (
          <ActionForm action={sendReportAction.bind(null, id)} submitLabel={`Enviar a ${client.contactEmail}`} pendingLabel="Enviando…" variant="secondary" className="max-w-md">
            <SelectField label="Periodo del informe" id="dias" defaultValue="30">
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="7">Últimos 7 días</option>
              <option value="365">Último año</option>
            </SelectField>
          </ActionForm>
        ) : (
          <p className="text-[15px] text-ink-muted">Agrega un correo de contacto en la ficha del cliente para poder enviarle el informe por email.</p>
        )}
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

      <Card title="Identificador" description="Es el nombre que aparece en las direcciones del panel y del portal.">
        <RenameSlugForm action={renameProjectSlugAction.bind(null, id, project.clientSlug)} current={project.slug} what="proyecto" aliases={project.slugAliases} />
      </Card>

      <Card title="Archivar proyecto" description="Lo oculta del panel y detiene sus auditorías. No borra nada: lo encuentras en Archivados, donde puedes restaurarlo o eliminarlo para siempre.">
        <div>
          <ActionForm action={archiveProjectAction.bind(null, id, project.clientId)} submitLabel="Archivar proyecto" variant="secondary" pendingLabel="Archivando…" />
        </div>
      </Card>
    </AdminShell>
  );
}
