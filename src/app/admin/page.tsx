import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/session";
import Link from "next/link";
import { Card } from "@/lib/ui/components/card";
import { AdminShell } from "./_components/admin-shell";
import { HealthPanel } from "./health-panel";

export const metadata: Metadata = {
  title: "Panel · AOC PageSpeed",
  robots: { index: false, follow: false },
};

export default async function AdminHome() {
  const session = await verifySession();
  return (
    <AdminShell email={session.email} title="Panel de administración">
      <Card title="Clientes y proyectos" description="Alta de clientes, proyectos, rutas y umbrales de alerta.">
        <div>
          <Link href="/admin/clientes" className="text-[17px] font-semibold text-link hover:underline">
            Ir a clientes
          </Link>
        </div>
      </Card>
      <Card>
        <HealthPanel />
      </Card>
    </AdminShell>
  );
}
