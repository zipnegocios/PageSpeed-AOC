import { firstScanAction } from "@/app/admin/proyectos/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import type { FirstScanSummary } from "@/server/services/audits";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * «Primer escaneo» de la tarjeta Rutas: audita en móvil y escritorio todas las rutas monitoreadas que aún no tienen
 * una auditoría correcta. Va fuera del desplegable del sitemap, para verlo siempre junto a la búsqueda.
 */
export function FirstScanBlock({ projectId, summary, hasMonitored }: { projectId: string; summary: FirstScanSummary; hasMonitored: boolean }) {
  const counts = [
    summary.routesToScan > 0 ? plural(summary.routesToScan, "ruta por escanear", "rutas por escanear") : "",
    summary.alreadyPending > 0 ? plural(summary.alreadyPending, "auditoría en cola o en curso", "auditorías en cola o en curso") : "",
    summary.skippedAuth > 0 ? plural(summary.skippedAuth, "ruta requiere sesión sin acceso configurado", "rutas requieren sesión sin acceso configurado") : "",
    summary.skippedHost > 0 ? plural(summary.skippedHost, "ruta con host no permitido", "rutas con host no permitido") : "",
  ].filter(Boolean);
  const empty = !hasMonitored
    ? "No hay rutas monitoreadas todavía."
    : counts.length === 0
      ? "Todas las rutas ya tienen su primer escaneo."
      : null;

  return (
    <section aria-labelledby="primer-escaneo-titulo" className="hud-flat flex flex-col gap-3 rounded-sm p-4">
      <h3 id="primer-escaneo-titulo" className="text-[13px] leading-4 font-semibold tracking-[0.08em] text-ink-muted uppercase">
        Primer escaneo
      </h3>
      <p className="text-[15px] leading-5 text-ink-muted">Audita en móvil y escritorio las rutas monitoreadas que aún no tienen una auditoría correcta.</p>
      <p className="text-[17px] text-ink">{empty ?? counts.join(" · ")}</p>
      {/* El formulario no se desmonta al quedar todo en cola: así el mensaje del resultado sigue a la vista. */}
      <ActionForm
        action={firstScanAction.bind(null, projectId)}
        submitLabel={summary.routesToScan > 0 ? "Primer escaneo de todas las rutas (móvil y escritorio)" : undefined}
        pendingLabel="Encolando…"
      />
      {summary.routesToScan > 0 ? (
        <p className="text-[15px] leading-5 text-ink-muted">
          El worker audita de una en una, así que un lote grande tarda. Si la cola no admite todas, vuelve a pulsar cuando avance.
        </p>
      ) : null}
    </section>
  );
}
