import { requireScope } from "@/lib/auth/access";
import { formatAgo } from "@/lib/audit-format";
import { AlertBell } from "@/lib/ui/components/alert-bell";
import { projectPath } from "@/lib/urls";
import { listOpenAlerts } from "@/server/services/alerts";

const MAX_IN_MENU = 5;

/** Carga las alertas abiertas para la campana de la barra superior. Si falla, la campana queda sin alertas (no tumba la página). */
export async function AlertBellLoader() {
  const now = new Date();
  const alerts = await requireScope().then(({ scope }) => listOpenAlerts(undefined, undefined, scope)).catch(() => []);
  const recent = [...alerts].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime()).slice(0, MAX_IN_MENU);
  return (
    <AlertBell
      count={alerts.length}
      alerts={recent.map((a) => ({
        id: a.id,
        href: projectPath(a.clientSlug, a.projectSlug),
        where: `${a.clientName} · ${a.projectName}`,
        what: `${a.routePath} · ${a.summary}`,
        since: `desde ${formatAgo(a.openedAt, now)}`,
      }))}
    />
  );
}
