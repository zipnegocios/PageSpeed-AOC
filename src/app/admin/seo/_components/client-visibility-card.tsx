import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import type { SeoSharing } from "@/server/services/seo-portal";
import { setSeoClientVisibleAction } from "../actions";

/**
 * Si el cliente ve «Tráfico y búsqueda» en su portal. Por defecto no: se activa proyecto por proyecto, cuando los datos ya
 * están revisados. El cliente ve el mismo panel que el administrador, sin estados de descarga, errores ni botones.
 */
export function ClientVisibilityCard({ projectId, sharing }: { projectId: string; sharing: SeoSharing }) {
  return (
    <Card
      title="Visible para el cliente"
      description="El cliente entra a su portal con su PIN y ve aquí el mismo panel de tráfico y búsqueda, solo de lectura."
      actions={<Badge tone={sharing.visible ? "ok" : "neutral"}>{sharing.visible ? "Visible" : "Oculto"}</Badge>}
    >
      {!sharing.inProduction ? (
        <Alert tone="info">Este proyecto está en desarrollo: el cliente lo ve en su portal con la etiqueta «En desarrollo». Si lo activas, también verá la salud SEO y, cuando existan, las visitas y la búsqueda.</Alert>
      ) : null}
      <p className="text-[15px] leading-5 text-ink-muted">
        {sharing.visible
          ? "El cliente ve los clics, impresiones, posición, sesiones y visitas desde asistentes de IA, con la comparación del periodo anterior y el reparto por idioma."
          : "Revisa primero que los datos estén al día y los idiomas bien declarados; después actívalo."}
      </p>
      <ActionForm
        action={setSeoClientVisibleAction.bind(null, projectId, !sharing.visible)}
        submitLabel={sharing.visible ? "Ocultar al cliente" : "Mostrar al cliente"}
        pendingLabel="Guardando…"
        variant={sharing.visible ? "secondary" : "primary"}
        className="max-w-xl"
      />
    </Card>
  );
}
