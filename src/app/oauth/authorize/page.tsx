import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalShell } from "@/app/c/_components/portal-shell";
import { pageTitle } from "@/lib/brand";
import { getSession } from "@/lib/auth/session";
import { Card } from "@/lib/ui/components/card";
import { PRESETS, PRESET_IDS } from "@/server/domain/mcp-scopes";
import { listClients } from "@/server/services/clients";
import { validateAuthorizeRequest } from "@/server/services/oauth";
import { listAllProjects } from "@/server/services/projects";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: pageTitle("Conectar una aplicación"), robots: { index: false, follow: false } };

type Query = Record<string, string | string[] | undefined>;

/** Solo valores de texto simple: lo que se reenvía a la acción de servidor. */
function flat(q: Query): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (typeof v === "string") out[k] = v;
  return out;
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = flat(await searchParams);
  const session = await getSession();
  if (!session) {
    // Sin sesión: se pasa por el inicio de sesión y se vuelve a esta misma solicitud.
    const back = `/oauth/authorize?${new URLSearchParams(query).toString()}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }

  let request;
  try {
    request = await validateAuthorizeRequest(query);
  } catch {
    // Cliente desconocido o dirección de retorno no permitida: nunca se redirige, y no se dice por qué.
    return (
      <PortalShell title="Conectar una aplicación" plainFooter>
        <Card>
          <p className="text-ink">Esta solicitud no es válida.</p>
        </Card>
      </PortalShell>
    );
  }

  const [clients, projects] = await Promise.all([listClients(), listAllProjects()]);
  const scopeClients = clients.map((c) => ({ id: c.id, name: c.name, projects: projects.filter((p) => p.clientId === c.id).map((p) => ({ id: p.id, name: p.name })) }));
  const presets = PRESET_IDS.map((id) => ({ id, label: PRESETS[id].label, description: PRESETS[id].description }));

  return (
    <PortalShell title="Conectar una aplicación" subtitle={`Sesión de ${session.email}`} plainFooter>
      <Card title={`«${request.clientName}» quiere conectarse a PageSpeed.`} description="Elige qué podrá ver y hacer.">
        <ConsentForm query={query} presets={presets} clients={scopeClients} />
      </Card>
    </PortalShell>
  );
}
