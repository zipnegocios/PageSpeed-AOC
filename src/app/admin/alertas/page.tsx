import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/session";
import { Card } from "@/lib/ui/components/card";
import { listOpenAlerts, listRecentNotifications } from "@/server/services/alerts";
import { AdminShell } from "../_components/admin-shell";
import { AlertList, NotificationList } from "../_components/alert-list";

export const metadata: Metadata = { title: "Alertas · AOC PageSpeed", robots: { index: false, follow: false } };

export default async function AlertsPage() {
  const session = await verifySession();
  const [alerts, notifications] = await Promise.all([listOpenAlerts(), listRecentNotifications(30)]);

  return (
    <AdminShell email={session.email} title="Alertas" crumbs={[{ label: "Panel", href: "/admin" }]}>
      <Card
        title={`Alertas abiertas (${alerts.length})`}
        description="Solo proyectos en producción. Se avisa por correo una vez y se recuerda cada 7 días mientras sigan abiertas; al recuperarse se cierran solas."
      >
        {alerts.length === 0 ? (
          <p className="text-ink-muted">No hay alertas abiertas. Todo lo auditado cumple sus umbrales.</p>
        ) : (
          <AlertList alerts={alerts} showProject />
        )}
      </Card>

      <Card title="Correos enviados" description="Los últimos 30 envíos de alertas, con su resultado.">
        {notifications.length === 0 ? (
          <p className="text-ink-muted">Todavía no se ha enviado ningún correo de alertas.</p>
        ) : (
          <NotificationList items={notifications} showProject />
        )}
      </Card>
    </AdminShell>
  );
}
