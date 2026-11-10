import { requireScope } from "@/lib/auth/access";
import type { Metadata } from "next";
import { normalize } from "@/lib/project-search";
import { Panel } from "@/lib/ui/components/panel";
import { ProjectCard } from "@/lib/ui/components/project-card";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { getFleet } from "@/server/services/dashboard";
import { AdminShell } from "../_components/admin-shell";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Proyectos"), robots: { index: false, follow: false } };

const PHASES = ["todos", "produccion", "desarrollo"] as const;
type Phase = (typeof PHASES)[number];

/** Todos los proyectos en un solo lugar, sin pasar por los clientes: buscar, filtrar por fase y abrir. */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; fase?: string }> }) {
  const { session, scope } = await requireScope();
  const { q = "", fase } = await searchParams;
  const phase: Phase = (PHASES as readonly string[]).includes(fase ?? "") ? (fase as Phase) : "todos";
  const all = await getFleet(undefined, undefined, scope);
  const words = normalize(q).split(/\s+/).filter(Boolean);
  const shown = all
    .filter((p) => phase === "todos" || (phase === "produccion" ? p.phase === "production" : p.phase === "development"))
    .filter((p) => words.every((w) => normalize(`${p.name} ${p.clientName} ${p.baseUrl}`).includes(w)));
  const href = (f: Phase) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (f !== "todos") params.set("fase", f);
    const qs = params.toString();
    return qs ? `/admin/proyectos?${qs}` : "/admin/proyectos";
  };
  const now = new Date();

  return (
    <AdminShell title="Proyectos" subtitle="Todos tus proyectos. Para ir directo a uno desde cualquier pantalla, pulsa / o Ctrl+K." crumbs={[{ label: "Panel", href: "/admin" }]}>
      <Panel
        title={`${shown.length} ${shown.length === 1 ? "proyecto" : "proyectos"}`}
        actions={
          <SegmentedNav
            label="Filtrar por fase"
            items={(
              [
                ["todos", "Todos"],
                ["produccion", "Producción"],
                ["desarrollo", "Desarrollo"],
              ] as const
            ).map(([id, label]) => ({ label, href: href(id), current: phase === id }))}
          />
        }
      >
        <form action="/admin/proyectos" method="get" role="search" className="flex flex-wrap items-center gap-3">
          {phase !== "todos" ? <input type="hidden" name="fase" value={phase} /> : null}
          <label htmlFor="q" className="sr-only">
            Buscar proyecto, cliente o dirección
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Buscar proyecto, cliente o dirección…"
            autoComplete="off"
            className="min-h-11 w-full max-w-md rounded-sm border border-border-strong bg-surface-100 px-3 text-[17px] text-ink placeholder:text-ink-muted"
          />
          <button type="submit" className="press min-h-11 cursor-pointer rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300">
            Buscar
          </button>
        </form>
        {shown.length === 0 ? (
          <p className="text-ink-muted">{all.length === 0 ? "Todavía no hay proyectos. Crea un cliente y su primer proyecto." : "Ningún proyecto coincide con la búsqueda."}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[...shown]
              .sort((a, b) => a.clientName.localeCompare(b.clientName, "es") || a.name.localeCompare(b.name, "es"))
              .map((p) => (
                <ProjectCard key={p.id} project={p} now={now} viewerId={session.role === "owner" ? null : session.id} />
              ))}
          </div>
        )}
      </Panel>
    </AdminShell>
  );
}
