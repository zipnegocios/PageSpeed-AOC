import type { Metadata } from "next";
import { appUrl } from "@/lib/not-found";
import { formatDate } from "@/lib/audit-format";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CopyButton } from "@/lib/ui/components/copy-button";
import { PRESETS, PRESET_IDS } from "@/server/domain/mcp-scopes";
import { listApiKeys } from "@/server/services/api-keys";
import { AdminShell } from "../_components/admin-shell";
import { revokeApiKeyAction } from "./actions";
import { CreateKeyForm } from "./_components/create-key-form";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Agentes"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await verifySession();
  const keys = await listApiKeys();
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
        <CreateKeyForm presets={presets} />
      </Card>

      <Card title={`Claves (${keys.length})`} description="La clave en sí no se guarda: solo queda su huella. Si se pierde, se revoca y se crea otra.">
        {keys.length === 0 ? (
          <p className="text-ink-muted">Aún no hay claves.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{k.name}</span>
                  <Badge tone={k.active ? "ok" : "danger"}>{k.active ? "Activa" : "Revocada"}</Badge>
                  <Badge>{k.preset === "custom" ? "Permisos personalizados" : PRESETS[k.preset].label}</Badge>
                </div>
                <p className="text-[15px] text-ink-muted">
                  Creada {formatDate(k.createdAt)} · {k.lastUsedAt ? `último uso ${formatDate(k.lastUsedAt)}` : "sin usar todavía"}
                  {k.revokedAt ? ` · revocada ${formatDate(k.revokedAt)}` : ""}
                </p>
                {k.active ? (
                  <ActionForm action={revokeApiKeyAction.bind(null, k.id)} submitLabel="Revocar" pendingLabel="Revocando…" variant="ghost" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
