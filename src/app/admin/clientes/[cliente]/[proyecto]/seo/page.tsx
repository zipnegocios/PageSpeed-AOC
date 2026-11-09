import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/admin-shell";
import { SeoDataSection } from "@/app/_components/seo/seo-data-section";
import { requestSeoSyncAction } from "@/app/admin/seo/actions";
import { ClientVisibilityCard } from "@/app/admin/seo/_components/client-visibility-card";
import { CrawlSection } from "@/app/admin/seo/_components/crawl-section";
import { ConnectionCard } from "@/app/admin/seo/_components/connection-card";
import { MarketsCard } from "@/app/admin/seo/_components/markets-card";
import { verifySession } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { orNotFound } from "@/lib/not-found";
import { clientPath, projectPath } from "@/lib/urls";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { SEO_KINDS } from "@/server/domain/seo-connections";
import { parseSeoPeriod } from "@/server/domain/seo-data";
import { getProjectByRef } from "@/server/services/projects";
import { getConnections, getGoogleAccount } from "@/server/services/seo-connections";
import { getCrawlReport } from "@/server/services/seo-crawl";
import { getSeoDashboard } from "@/server/services/seo-data";
import { getMarkets, getMarketSuggestions } from "@/server/services/seo-markets";
import { getSeoSharing } from "@/server/services/seo-portal";

export const metadata: Metadata = { title: pageTitle("SEO del proyecto"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProjectSeoPage({ params, searchParams }: { params: Promise<{ cliente: string; proyecto: string }>; searchParams: Promise<{ periodo?: string | string[]; idioma?: string | string[]; hallazgo?: string | string[] }> }) {
  await verifySession();
  const { cliente, proyecto } = await params;
  const query = await searchParams;
  const periodo = Array.isArray(query.periodo) ? query.periodo[0] : query.periodo;
  const idioma = Array.isArray(query.idioma) ? query.idioma[0] : query.idioma;
  const hallazgo = Array.isArray(query.hallazgo) ? query.hallazgo[0] : query.hallazgo;
  const project = await orNotFound(getProjectByRef(cliente, proyecto));
  // Un enlace antiguo con UUID se lleva a la dirección legible.
  if (cliente !== project.clientSlug || proyecto !== project.slug) redirect(`${projectPath(project.clientSlug, project.slug)}/seo`);
  const [connections, google] = await Promise.all([getConnections(project.id), getGoogleAccount()]);
  const googleEmail = google.configured && !google.unreadable ? google.email : null;
  const hasData = Boolean(connections.gsc || connections.ga4);
  const days = parseSeoPeriod(periodo);
  const crawl = await getCrawlReport(project.id, { lang: idioma, code: hallazgo });
  const basePath = `${projectPath(project.clientSlug, project.slug)}/seo`;
  const [markets, suggestions, sharing, dashboard] = hasData
    ? await Promise.all([getMarkets(project.id), getMarketSuggestions(project.id), getSeoSharing(project.id), getSeoDashboard(project.id, { days, lang: idioma })])
    : [[], [], null, null];

  return (
    <AdminShell
      title="SEO y visibilidad"
      subtitle={
        <span>
          {project.name} ·{" "}
          <Link href={projectPath(project.clientSlug, project.slug)} className="underline underline-offset-2 hover:text-ink">
            Volver al proyecto
          </Link>
        </span>
      }
      crumbs={[
        { label: "Panel", href: "/admin" },
        { label: "Clientes", href: "/admin/clientes" },
        { label: project.clientName, href: clientPath(project.clientSlug) },
        { label: project.name, href: projectPath(project.clientSlug, project.slug) },
      ]}
    >
      {!googleEmail ? (
        <Alert tone="info">
          Antes de conectar Search Console o GA4 hay que configurar la cuenta de servicio de Google, una sola vez para todo el panel.{" "}
          <Link href="/admin/seo" className="font-semibold underline underline-offset-2">
            Configurarla ahora
          </Link>
          .
        </Alert>
      ) : null}
      {dashboard ? (
        <SeoDataSection
          dashboard={dashboard}
          days={days}
          basePath={basePath}
          search={{ periodo, idioma, hallazgo }}
          syncForm={<ActionForm action={requestSeoSyncAction.bind(null, project.id)} submitLabel="Actualizar ahora" pendingLabel="Pidiendo…" variant="secondary" className="max-w-xl" />}
        />
      ) : null}
      <CrawlSection projectId={project.id} report={crawl} basePath={basePath} search={{ periodo, idioma, hallazgo }} />
      {sharing ? <ClientVisibilityCard projectId={project.id} sharing={sharing} /> : null}
      {hasData ? <MarketsCard projectId={project.id} markets={markets} suggestions={suggestions} /> : null}
      {SEO_KINDS.map((kind) => (
        <ConnectionCard key={kind} projectId={project.id} kind={kind} connection={connections[kind]} googleEmail={googleEmail} />
      ))}
    </AdminShell>
  );
}
