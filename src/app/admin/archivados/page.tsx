import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { formatDate } from "@/lib/audit-format";
import { listArchivedClients, listArchivedProjects } from "@/server/services/archive";
import { AdminShell } from "../_components/admin-shell";
import { DeleteConfirmForm } from "../_components/delete-confirm-form";
import { deleteClientAction, deleteProjectAction, restoreClientAction, restoreProjectAction } from "./actions";

export const metadata: Metadata = { title: "Archivados · AOC PageSpeed", robots: { index: false, follow: false } };

export default async function ArchivedPage() {
  const session = await verifySession();
  const [clients, projects] = await Promise.all([listArchivedClients(), listArchivedProjects()]);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <AdminShell email={session.email} title="Archivados" crumbs={[{ label: "Panel", href: "/admin" }]}>
      <Card
        title="Clientes archivados"
        description="Fuera del panel y sin auditorías; su link del portal ya no funciona. Puedes restaurarlos o eliminarlos para siempre."
      >
        {clients.length === 0 ? (
          <p className="text-ink-muted">No hay clientes archivados.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {clients.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[19px] font-semibold break-words text-ink">{c.name}</span>
                    <span className="text-[15px] text-ink-muted">
                      Archivado el {formatDate(c.archivedAt)} · {plural(c.projectCount, "proyecto", "proyectos")}
                    </span>
                  </span>
                  <Badge tone="neutral">Archivado</Badge>
                </div>
                <ActionForm action={restoreClientAction.bind(null, c.id)} submitLabel="Restaurar" pendingLabel="Restaurando…" variant="secondary" />
                <details className="rounded-sm border border-border p-3">
                  <summary className="cursor-pointer text-[17px] font-semibold text-danger">Eliminar definitivamente</summary>
                  <DeleteConfirmForm
                    action={deleteClientAction.bind(null, c.id)}
                    name={c.name}
                    label="Eliminar cliente para siempre"
                    consequence={`Se borran el cliente, ${plural(c.projectCount, "proyecto", "proyectos")} con sus auditorías, alertas e informes guardados. No se puede deshacer.`}
                  />
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Proyectos archivados"
        description="Proyectos de clientes que siguen en el panel. Los de un cliente archivado se eliminan junto con su cliente."
      >
        {projects.length === 0 ? (
          <p className="text-ink-muted">No hay proyectos archivados.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {projects.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[19px] font-semibold break-words text-ink">{p.name}</span>
                    <span className="text-[15px] break-all text-ink-muted">
                      {p.clientName} · {p.baseUrl} · archivado el {formatDate(p.archivedAt)}
                    </span>
                  </span>
                  <Badge tone="neutral">Archivado</Badge>
                </div>
                <ActionForm action={restoreProjectAction.bind(null, p.id)} submitLabel="Restaurar" pendingLabel="Restaurando…" variant="secondary" />
                <details className="rounded-sm border border-border p-3">
                  <summary className="cursor-pointer text-[17px] font-semibold text-danger">Eliminar definitivamente</summary>
                  <DeleteConfirmForm
                    action={deleteProjectAction.bind(null, p.id)}
                    name={p.name}
                    label="Eliminar proyecto para siempre"
                    consequence="Se borran el proyecto, sus rutas, auditorías, alertas e informes guardados. No se puede deshacer."
                  />
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
