import type { ReactNode } from "react";
import { formatDate } from "@/lib/audit-format";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CopyButton } from "@/lib/ui/components/copy-button";
import { Field } from "@/lib/ui/components/field";
import type { SeoKind } from "@/server/domain/seo-connections";
import type { SeoConnection } from "@/server/services/seo-connections";
import { removeConnectionAction, saveConnectionAction, testConnectionAction } from "../actions";

type Copy = {
  title: string;
  description: string;
  idLabel: string;
  idPlaceholder: string;
  idHint: string;
  steps: (email: string | null) => ReactNode[];
};

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
    {text}
  </a>
);

const COPY: Record<SeoKind, Copy> = {
  gsc: {
    title: "Search Console",
    description: "Clics, impresiones y posición en Google por página, país y dispositivo, más indexación y sitemaps.",
    idLabel: "Propiedad de Search Console",
    idPlaceholder: "sc-domain:ejemplo.com",
    idHint: "Propiedad de dominio: escribe sc-domain:ejemplo.com o solo el dominio. Propiedad de prefijo de URL: pega la URL completa, por ejemplo https://ejemplo.com/.",
    steps: (email) => [
      <>
        Abre {link("https://search.google.com/search-console", "Search Console")}, elige la propiedad del cliente y entra en <strong className="text-ink">Configuración → Usuarios y permisos</strong>.
      </>,
      <>
        Pulsa <strong className="text-ink">Agregar usuario</strong>, pega el correo {email ? <span className="font-mono break-all text-ink">{email}</span> : "de la cuenta de servicio"} y deja el permiso en <strong className="text-ink">Restringido</strong>. Solo un propietario de la propiedad puede agregar usuarios.
      </>,
      "Escribe aquí la propiedad tal como aparece en Search Console y guarda.",
    ],
  },
  ga4: {
    title: "Google Analytics 4",
    description: "Visitas reales por página, país, idioma y fuente, incluidas las que llegan desde asistentes de IA.",
    idLabel: "ID de la propiedad de GA4",
    idPlaceholder: "123456789",
    idHint: "Es un número: en GA4, Administrar → Detalles de la propiedad. No es el ID de medición que empieza por G-.",
    steps: (email) => [
      <>
        Abre {link("https://analytics.google.com/analytics/web/", "Google Analytics")}, entra en <strong className="text-ink">Administrar → Administración de accesos a la propiedad</strong> y pulsa <strong className="text-ink">+</strong>.
      </>,
      <>
        Agrega el correo {email ? <span className="font-mono break-all text-ink">{email}</span> : "de la cuenta de servicio"} con el rol <strong className="text-ink">Lector</strong>.
      </>,
      "Copia el ID numérico de la propiedad, pégalo aquí y guarda.",
    ],
  },
  cloudflare: {
    title: "Cloudflare",
    description: "Qué rastreadores de IA descargan el sitio, qué rutas piden y qué visitas llegan desde asistentes. Solo si el sitio está detrás de Cloudflare.",
    idLabel: "ID de zona",
    idPlaceholder: "32 caracteres, letras a-f y números",
    idHint: "Está en la página principal de la zona en Cloudflare, a la derecha, en «ID de zona».",
    steps: () => [
      <>
        En Cloudflare entra en <strong className="text-ink">Mi perfil → Tokens de API → Crear token → Crear token personalizado</strong>.
      </>,
      <>
        Dale un solo permiso: <strong className="text-ink">Zona · Analíticas · Leer</strong>, limitado a la zona de este cliente.
      </>,
      "Pega aquí el token y el ID de zona, y guarda. El token se guarda cifrado y no se vuelve a mostrar.",
    ],
  },
};

const STATUS = {
  ok: { tone: "ok", label: "Conectado" },
  error: { tone: "danger", label: "Falla" },
  pending: { tone: "neutral", label: "Sin probar" },
} as const;

/** Tarjeta de una conexión del proyecto: pasos, campos, estado y botón de probar. */
export function ConnectionCard({ projectId, kind, connection, googleEmail }: { projectId: string; kind: SeoKind; connection: SeoConnection | null; googleEmail: string | null }) {
  const copy = COPY[kind];
  const status = connection ? STATUS[connection.status] : null;
  const usesGoogle = kind !== "cloudflare";

  return (
    <Card title={copy.title} description={copy.description} actions={<Badge tone={status?.tone ?? "neutral"}>{status?.label ?? "Sin configurar"}</Badge>}>
      {connection ? (
        <p className="text-[15px] leading-5 text-ink-muted">
          Guardado: <span className="font-mono break-all text-ink">{connection.externalId}</span>
          {connection.hasCredential ? " · con token" : ""}
        </p>
      ) : null}
      {connection?.detail ? (
        <p className={connection.status === "error" ? "text-[15px] leading-5 text-on-danger-subtle" : "text-[15px] leading-5 text-ink-muted"}>
          {connection.detail}
          {connection.lastCheckedAt ? <span className="text-ink-muted"> · Última prueba: {formatDate(connection.lastCheckedAt)}</span> : null}
        </p>
      ) : null}

      <details className="rounded-sm border border-border p-4" open={!connection}>
        <summary className="cursor-pointer text-[19px] font-semibold text-ink">Cómo conectarlo</summary>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-5 text-ink-muted">
          {copy.steps(googleEmail).map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {usesGoogle && googleEmail ? (
          <div className="mt-3">
            <CopyButton value={googleEmail} label="Copiar el correo de la cuenta de servicio" />
          </div>
        ) : null}
      </details>

      <ActionForm action={saveConnectionAction.bind(null, projectId, kind)} submitLabel="Guardar" pendingLabel="Guardando…" className="max-w-xl">
        <Field label={copy.idLabel} id={`${kind}_externalId`} required defaultValue={connection?.externalId} placeholder={copy.idPlaceholder} autoComplete="off" spellCheck={false} hint={copy.idHint} />
        {kind === "cloudflare" ? (
          <Field
            label="Token de Cloudflare"
            id={`${kind}_token`}
            type="password"
            autoComplete="new-password"
            required={!connection?.hasCredential}
            placeholder={connection?.hasCredential ? "Guardado (déjalo vacío para conservarlo)" : ""}
            hint="Se guarda cifrado y no se vuelve a mostrar."
          />
        ) : null}
      </ActionForm>

      {connection ? (
        <div className="flex flex-wrap items-end gap-3">
          <ActionForm action={testConnectionAction.bind(null, projectId, kind)} submitLabel="Probar conexión" pendingLabel="Probando…" variant="secondary" className="max-w-xl" />
          <ActionForm action={removeConnectionAction.bind(null, projectId, kind)} submitLabel="Quitar" pendingLabel="Quitando…" variant="ghost" />
        </div>
      ) : null}
    </Card>
  );
}
