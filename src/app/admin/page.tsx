import type { Metadata } from "next";
import { Suspense } from "react";
import { verifySession } from "@/lib/auth/session";
import { AdminShell } from "./_components/admin-shell";
import { AlertsPanel, FleetSection, OpsSection, RecentAuditsPanel, type PhaseFilter } from "./_components/dashboard-panels";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: pageTitle("Panel"),
  robots: { index: false, follow: false },
};

const PHASES: PhaseFilter[] = ["todos", "produccion", "desarrollo"];

/** Marcador de un panel mientras llegan sus datos; cada panel carga por separado y uno lento no bloquea al resto. */
function PanelSkeleton({ span = 1, label }: { span?: 1 | 2 | 4; label: string }) {
  const cols = span === 4 ? "md:col-span-2 xl:col-span-4" : span === 2 ? "md:col-span-2" : "";
  return (
    <div role="status" aria-label={`Cargando ${label}`} className={`hud min-h-40 rounded-lg motion-safe:animate-pulse ${cols}`}>
      <span className="sr-only">Cargando {label}…</span>
    </div>
  );
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ fase?: string }> }) {
  await verifySession();
  const { fase } = await searchParams;
  const phase = (PHASES as string[]).includes(fase ?? "") ? (fase as PhaseFilter) : "todos";

  return (
    <AdminShell title="Panel" subtitle="El estado de todos tus proyectos, de un vistazo.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Suspense fallback={<PanelSkeleton span={4} label="la flota" />}>
          <FleetSection phase={phase} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton span={2} label="las auditorías recientes" />}>
          <RecentAuditsPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton span={2} label="las alertas" />}>
          <AlertsPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton span={4} label="la cola" />}>
          <OpsSection />
        </Suspense>
      </div>
    </AdminShell>
  );
}
