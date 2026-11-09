import type { Metadata } from "next";
import { appUrl } from "@/lib/not-found";
import { formatDate } from "@/lib/audit-format";
import { verifySession } from "@/lib/auth/session";
import { Card } from "@/lib/ui/components/card";
import { CopyButton } from "@/lib/ui/components/copy-button";
import { accessSummary, type KeyAccess } from "@/server/domain/mcp-access";
import { PRESETS, PRESET_IDS } from "@/server/domain/mcp-scopes";
import { listApiKeys, type ApiKeyView } from "@/server/services/api-keys";
import { listClients } from "@/server/services/clients";
import { listAllProjects } from "@/server/services/projects";
import { AdminShell } from "../_components/admin-shell";
import { CreateKeyForm } from "./_components/create-key-form";
import { KeyRow, type KeyRowData } from "./_components/key-row";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Agentes"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Lo que la fila de una clave necesita, ya en texto (el componente de la fila vive en el cliente). */
function rowOf(k: ApiKeyView): KeyRowData {
  const access: KeyAccess = k.scope.all ? { all: true } : { all: false, clientIds: k.scope.clients.map((c) => c.id), projectIds: k.scope.projects.map((x) => x.id) };
  const names = [...k.scope.clients.map((c) => `${c.name} (todos sus proyectos)`), ...k.scope.projects.map((x) => `${x.clientName} · ${x.name}`)];
  return {
    id: k.id,
    name: k.name,
    active: k.active,
    presetLabel: k.preset === "custom" ? "Permisos personalizados" : PRESETS[k.preset].label,
    scopeBadge: accessSummary(access),
    scopeAll: k.scope.all,
    scopeText: k.scope.all ? null : names.join(" · ") || "Los clientes y proyectos elegidos ya no existen.",
    created: formatDate(k.createdAt),
    lastUsed: k.lastUsedAt ? formatDate(k.lastUsedAt) : null,
    rotated: k.rotatedAt ? formatDate(k.rotatedAt) : null,
    revoked: k.revokedAt ? formatDate(k.revokedAt) : null,
    values: {
      name: k.name,
      preset: k.preset === "custom" ? null : k.preset,
      all: k.scope.all,
      clientIds: k.scope.clients.map((c) => c.id),
      projectIds: k.scope.projects.map((x) => x.id),
    },
  };
}

export default async function AgentsPage() {
  const session = await verifySession();
  const [keys, clients, projects] = await Promise.all([listApiKeys(), listClients(), listAllProjects()]);
  const scopeClients = clients.map((c) => ({ id: c.id, name: c.name, projects: projects.filter((p) => p.clientId === c.id).map((p) => ({ id: p.id, name: p.name })) }));
  const endpoint = `${appUrl()}/api/mcp`;
  const cli = `claude mcp add --transport http pagespeed ${endpoint} --header "Authorization: Bearer TU_CLAVE"`;
  const json = JSON.stringify({ mcpServers: { "pagespeed": { type: "http", url: endpoint, headers: { Authorization: "Bearer TU_CLAVE" } } } }, null, 2);
  const presets = PRESET_IDS.map((id) => ({ id, label: PRESETS[id].label, description: PRESETS[id].description }));

  return (
    <AdminShell email={session.email} title="Agentes (MCP)" crumbs={[{ label: "Panel", href: "/admin" }]}>
      <Card title="Conexión" description="Un agente de IA se conecta a este servidor MCP con una clave. Sustituye TU_CLAVE por la que crees abajo.">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Dirección</p>
          <code className="block rounded-sm bg-surface-300 p-3 font-mono text-[14px] break-all text-ink">{endpoint}</code>
          <div>
            <CopyButton value={endpoint} label="Copiar dirección" />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Claude Code</p>
          <code className="block rounded-sm bg-surface-300 p-3 font-mono text-[14px] break-all text-ink">{cli}</code>
          <div>
            <CopyButton value={cli} label="Copiar comando" />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Otros clientes (JSON)</p>
          <pre className="overflow-x-auto rounded-sm bg-surface-300 p-3 font-mono text-[14px] text-ink">{json}</pre>
          <div>
            <CopyButton value={json} label="Copiar JSON" />
          </div>
        </div>
      </Card>

      <Card title="Nueva clave" description="Cada agente debería tener la suya: así puedes revocarla sin afectar a los demás. Nunca borra proyectos, cambia fases, rota links ni suspende clientes.">
        <CreateKeyForm presets={presets} clients={scopeClients} />
      </Card>

      <Card title={`Claves (${keys.length})`} description="La clave en sí no se guarda: solo queda su huella. Si se pierde o se filtra, rótala (la anterior deja de servir al instante) o revócala.">
        {keys.length === 0 ? (
          <p className="text-ink-muted">Aún no hay claves.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {keys.map((k) => (
              <KeyRow key={k.id} k={rowOf(k)} presets={presets} clients={scopeClients} />
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
