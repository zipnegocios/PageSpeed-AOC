import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { projectPath } from "@/lib/urls";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CopyButton } from "@/lib/ui/components/copy-button";
import { TextareaField } from "@/lib/ui/components/field";
import { KIND_LABEL, SEO_KINDS } from "@/server/domain/seo-connections";
import { authKeyStatus } from "@/server/services/project-auth";
import { getGoogleAccount, getSeoOverview } from "@/server/services/seo-connections";
import { AdminShell } from "../_components/admin-shell";
import { clearGoogleAccountAction, saveGoogleAccountAction } from "./actions";

export const metadata: Metadata = { title: pageTitle("SEO"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATE = {
  ok: { tone: "ok", text: "Conectado" },
  error: { tone: "danger", text: "Falla" },
  pending: { tone: "neutral", text: "Sin probar" },
} as const;

const ext = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
    {text}
  </a>
);

export default async function SeoPage() {
  const session = await verifySession();
  const [google, overview] = await Promise.all([getGoogleAccount(), getSeoOverview()]);
  const keyStatus = authKeyStatus();

  return (
    <AdminShell
      email={session.email}
      title="SEO y visibilidad"
      subtitle="Cómo se encuentra y se usa cada sitio: búsqueda, visitas y presencia en asistentes de IA."
      crumbs={[{ label: "Panel", href: "/admin" }]}
    >
      <Card
        title="Cuenta de servicio de Google"
        description="Se configura una sola vez para todo el panel. Con ella se leen Search Console y GA4 de los clientes que te den acceso."
        actions={<Badge tone={google.configured && !google.unreadable ? "ok" : google.configured ? "danger" : "neutral"}>{google.configured ? (google.unreadable ? "No se puede leer" : "Conectada") : "Sin configurar"}</Badge>}
      >
        {keyStatus !== "ok" ? (
          <Alert tone="danger">
            {keyStatus === "missing"
              ? "Falta AUTH_ENCRYPTION_KEY en el servicio web. Créala con «openssl rand -base64 32» y cárgala igual en el web y en el worker antes de guardar credenciales."
              : "AUTH_ENCRYPTION_KEY no es válida: debe ser de 32 bytes en base64 («openssl rand -base64 32»)."}
          </Alert>
        ) : null}

        {google.configured ? (
          <div className="flex flex-col gap-2">
            <p className="text-[15px] leading-5 text-ink-muted">Correo de la cuenta (es el que se agrega en cada cliente):</p>
            <p className="font-mono text-[17px] break-all text-ink">{google.email}</p>
            <div>
              <CopyButton value={google.email} label="Copiar el correo" />
            </div>
            {!google.unreadable ? (
              <Alert tone="info">
                Siguiente paso: abre la pestaña <strong>SEO</strong> de un proyecto (desde la lista de abajo) y agrega ese correo en el Search Console y el GA4 del cliente. Ahí mismo la plataforma te lo explica paso a paso.
              </Alert>
            ) : null}
            {google.unreadable ? <Alert tone="danger">Hay una cuenta guardada, pero no se puede leer con la clave de cifrado actual. Pega la llave de nuevo.</Alert> : null}
          </div>
        ) : null}

        <details className="rounded-sm border border-border p-4" open={!google.configured}>
          <summary className="cursor-pointer text-[19px] font-semibold text-ink">{google.configured ? "Cambiar la llave" : "Cómo conectarla"}</summary>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-5 text-ink-muted">
            <li>
              En {ext("https://console.cloud.google.com/apis/library", "Google Cloud")}, crea un proyecto (o usa el de CrUX) y habilita <strong className="text-ink">Google Search Console API</strong> y <strong className="text-ink">Google Analytics Data API</strong>.
            </li>
            <li>
              En {ext("https://console.cloud.google.com/iam-admin/serviceaccounts", "Cuentas de servicio")}, crea una cuenta (sin roles). Dentro de ella, <strong className="text-ink">Claves → Agregar clave → Crear clave nueva → JSON</strong>.
            </li>
            <li>Abre el archivo descargado, copia todo su contenido y pégalo abajo. Se guarda cifrado y no se vuelve a mostrar.</li>
            <li>Después, en la pestaña SEO de cada proyecto, la plataforma te dice dónde agregar el correo de la cuenta.</li>
          </ol>
          <ActionForm action={saveGoogleAccountAction} submitLabel="Guardar y comprobar" pendingLabel="Comprobando con Google…" resetOnSuccess className="mt-4 max-w-2xl">
            <TextareaField
              label="Contenido del archivo JSON"
              id="serviceAccount"
              required
              rows={6}
              autoComplete="off"
              spellCheck={false}
              className="font-mono [-webkit-text-security:disc]"
              placeholder='{ "type": "service_account", … }'
              hint="Se comprueba con Google al guardar: si la llave no sirve, te lo dice aquí mismo."
            />
          </ActionForm>
        </details>

        {google.configured ? <ActionForm action={clearGoogleAccountAction} submitLabel="Quitar la cuenta" pendingLabel="Quitando…" variant="ghost" /> : null}
      </Card>

      <Card title={`Proyectos (${overview.length})`} description="Estado de las conexiones de cada proyecto. Entra en uno para conectarlo.">
        {overview.length === 0 ? (
          <p className="text-[17px] text-ink-muted">Todavía no hay proyectos.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {overview.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <Link href={`${projectPath(p.clientSlug, p.slug)}/seo`} className="press text-[19px] font-semibold text-ink underline-offset-2 hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-[15px] text-ink-muted">{p.clientName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {SEO_KINDS.map((kind) => {
                    const state = p.connections[kind];
                    return (
                      <span key={kind} className="inline-flex items-center gap-2 text-[15px] text-ink-muted">
                        {KIND_LABEL[kind]}
                        <Badge tone={state ? STATE[state].tone : "neutral"}>{state ? STATE[state].text : "—"}</Badge>
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
