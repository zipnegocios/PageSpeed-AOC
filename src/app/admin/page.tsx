import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/session";
import Link from "next/link";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { listOpenAlerts } from "@/server/services/alerts";
import { AdminShell } from "./_components/admin-shell";
import { HealthPanel } from "./health-panel";

export const metadata: Metadata = {
  title: "Panel · AOC PageSpeed",
  robots: { index: false, follow: false },
};

export default async function AdminHome() {
  const session = await verifySession();
  const alerts = await listOpenAlerts().catch(() => []);
  return (
    <AdminShell email={session.email} title="Panel de administración">
      <Card title="Clientes y proyectos" description="Alta de clientes, proyectos, rutas y umbrales de alerta.">
        <div>
          <Link href="/admin/clientes" className="text-[17px] font-semibold text-link hover:underline">
            Ir a clientes
          </Link>
        </div>
      </Card>
      <Card title="Alertas" description="Proyectos en producción por debajo de sus umbrales o con auditorías que fallan.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={alerts.length > 0 ? "danger" : "ok"}>
            {alerts.length === 0 ? "Sin alertas abiertas" : `${alerts.length} ${alerts.length === 1 ? "alerta abierta" : "alertas abiertas"}`}
          </Badge>
          <Link href="/admin/alertas" className="text-[17px] font-semibold text-link hover:underline">
            Ver alertas
          </Link>
        </div>
      </Card>
      <Card>
        <HealthPanel />
      </Card>
    </AdminShell>
  );
}
