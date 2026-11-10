import { Badge } from "@/lib/ui/components/badge";

/** «En producción» o «En desarrollo»: el cliente ve los dos y debe poder distinguirlos de un vistazo (siempre con texto, el color solo refuerza). */
export function PhaseBadge({ phase }: { phase: "development" | "production" }) {
  return <Badge tone={phase === "production" ? "ok" : "warning"}>{phase === "production" ? "En producción" : "En desarrollo"}</Badge>;
}

/** Aviso del Resumen cuando el sitio todavía se está construyendo: qué significa lo que se ve y qué empieza al publicar. */
export function DevelopmentNotice() {
  return (
    <div role="note" className="rounded-lg bg-surface-200 p-4 text-[15px] leading-6 text-ink shadow-[0_0_0_1px_rgba(17,24,39,0.05)]">
      <p className="font-semibold">Tu sitio está en desarrollo</p>
      <p className="text-ink-muted">Aquí ves cómo avanza: las notas cambian cada vez que se audita. Las alertas y los correos automáticos empiezan cuando pase a producción.</p>
    </div>
  );
}
