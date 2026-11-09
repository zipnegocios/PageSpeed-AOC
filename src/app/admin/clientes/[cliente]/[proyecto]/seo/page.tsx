import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/admin-shell";
import { ConnectionCard } from "@/app/admin/seo/_components/connection-card";
import { MarketsCard } from "@/app/admin/seo/_components/markets-card";
import { SeoDataSection } from "@/app/admin/seo/_components/seo-data-section";
import { verifySession } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { orNotFound } from "@/lib/not-found";
import { clientPath, projectPath } from "@/lib/urls";
import { Alert } from "@/lib/ui/components/alert";
import { SEO_KINDS } from "@/server/domain/seo-connections";
import { getProjectByRef } from "@/server/services/projects";
import { getConnections, getGoogleAccount } from "@/server/services/seo-connections";
import { getMarkets, getMarketSuggestions } from "@/server/services/seo-markets";

export const metadata: Metadata = { title: pageTitle("SEO del proyecto"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProjectSeoPage({ params, searchParams }: { params: Promise<{ cliente: string; proyecto: string }>; searchParams: Promise<{ dias?: string | string[]; idioma?: string | string[] }> }) {
  await verifySession();
  const { cliente, proyecto } = await params;
  const { dias, idioma } = await searchParams;
  const project = await orNotFound(getProjectByRef(cliente, proyecto));
  // Un enlace antiguo con UUID se lleva a la dirección legible.
  if (cliente !== project.clientSlug || proyecto !== project.slug) redirect(`${projectPath(project.clientSlug, project.slug)}/seo`);
  const [connections, google] = await Promise.all([getConnections(project.id), getGoogleAccount()]);
  const googleEmail = google.configured && !google.unreadable ? google.email : null;
  const hasData = Boolean(connections.gsc || connections.ga4);
  const [markets, suggestions] = hasData ? await Promise.all([getMarkets(project.id), getMarketSuggestions(project.id)]) : [[], []];

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
      {hasData ? <SeoDataSection projectId={project.id} basePath={`${projectPath(project.clientSlug, project.slug)}/seo`} dias={dias} idioma={idioma} /> : null}
      {hasData ? <MarketsCard projectId={project.id} markets={markets} suggestions={suggestions} /> : null}
      {SEO_KINDS.map((kind) => (
        <ConnectionCard key={kind} projectId={project.id} kind={kind} connection={connections[kind]} googleEmail={googleEmail} />
      ))}
    </AdminShell>
  );
}
