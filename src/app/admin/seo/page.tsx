import { requireScope } from "@/lib/auth/access";
import type { Metadata } from "next";
import Link from "next/link";
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
import { getGoogleAccount, getSeoOverview, GOOGLE_ACCOUNT_ENV } from "@/server/services/seo-connections";
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
  const { session, scope } = await requireScope();
  // La cuenta de servicio de Google es de todo el sistema: solo el propietario la ve y la cambia.
  const isOwner = session.role === "owner";
  const [google, overview] = await Promise.all([getGoogleAccount(), getSeoOverview(undefined, scope)]);
  const keyStatus = authKeyStatus();

  return (
    <AdminShell
      title="SEO y visibilidad"
      subtitle="Cómo se encuentra y se usa cada sitio: búsqueda, visitas y presencia en asistentes de IA."
      crumbs={[{ label: "Panel", href: "/admin" }]}
    >
      {isOwner ? (
      <Card
        title="Cuenta de servicio de Google"
        description="Se configura una sola vez para todo el panel. Con ella se leen Search Console y GA4 de los clientes que te den acceso."
        actions={<Badge tone={google.configured && !google.unreadable ? "ok" : google.configured || google.envError ? "danger" : "neutral"}>{google.configured ? (google.unreadable ? "No se puede leer" : "Conectada") : google.envError ? "Variable no válida" : "Sin configurar"}</Badge>}
      >
        {keyStatus !== "ok" ? (
          <Alert tone="danger">
            {keyStatus === "missing"
              ? "Falta AUTH_ENCRYPTION_KEY en el servicio web. Créala con «openssl rand -base64 32» y cárgala igual en el web y en el worker antes de guardar credenciales."
              : "AUTH_ENCRYPTION_KEY no es válida: debe ser de 32 bytes en base64 («openssl rand -base64 32»)."}
          </Alert>
        ) : null}

        {!google.configured && google.envError ? <Alert tone="danger">{google.envError}</Alert> : null}

        {google.configured ? (
          <div className="flex flex-col gap-2">
            <p className="text-[15px] leading-5 text-ink-muted">Correo de la cuenta (es el que se agrega en cada cliente):</p>
            <p className="font-mono text-[17px] break-all text-ink">{google.email}</p>
            <div>
              <CopyButton value={google.email} label="Copiar el correo" />
            </div>
            {google.source === "env" ? (
              <p className="text-[15px] leading-5 text-ink-muted">
                Viene de la variable de entorno <span className="font-mono text-ink">{GOOGLE_ACCOUNT_ENV}</span>. Para cambiarla, edítala en EasyPanel y reinicia el servicio.
              </p>
            ) : null}
            {!google.unreadable ? (
              <Alert tone="info">
                Siguiente paso: abre la pestaña <strong>SEO</strong> de un proyecto (desde la lista de abajo) y agrega ese correo en el Search Console y el GA4 del cliente. Ahí mismo la plataforma te lo explica paso a paso.
              </Alert>
            ) : null}
            {google.unreadable ? <Alert tone="danger">Hay una cuenta guardada, pero no se puede leer con la clave de cifrado actual. Pega la llave de nuevo.</Alert> : null}
          </div>
        ) : null}

        {!(google.configured && google.source === "env") ? (
          <details className="rounded-sm border border-border p-4" open={!google.configured}>
            <summary className="cursor-pointer text-[19px] font-semibold text-ink">{google.configured ? "Cambiar la llave" : "Cómo conectarla"}</summary>
            <div className="mt-3 flex flex-col gap-3">
              <Alert tone="info">
                <strong>No sirve una clave de API</strong> (las de «Claves de API» en Google Cloud): Search Console y Google Analytics acceden a datos privados y exigen una <strong>cuenta de servicio</strong>, que se crea en el paso 2.
              </Alert>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-5 text-ink-muted">
                <li>
                  En {ext("https://console.cloud.google.com/apis/library", "Google Cloud")}, crea un proyecto (o usa el de CrUX) y habilita <strong className="text-ink">Google Search Console API</strong> y <strong className="text-ink">Google Analytics Data API</strong>.
                </li>
                <li>
                  En {ext("https://console.cloud.google.com/iam-admin/serviceaccounts", "Cuentas de servicio")}, crea una cuenta (sin roles). Dentro de ella, <strong className="text-ink">Claves → Agregar clave → Crear clave nueva → JSON</strong>.
                </li>
                <li>Abre el archivo descargado y entrega su contenido a la plataforma de una de estas dos formas.</li>
                <li>Después, en la pestaña SEO de cada proyecto, la plataforma te dice dónde agregar el correo de la cuenta.</li>
              </ol>
              <div className="rounded-sm border border-border p-3 text-[15px] leading-5 text-ink-muted">
                <p className="font-semibold text-ink">Opción A: variable de entorno en EasyPanel</p>
                <p className="mt-1">
                  En el servicio web, define <span className="font-mono text-ink">{GOOGLE_ACCOUNT_ENV}</span> con el contenido del archivo (en una sola línea) o con ese mismo contenido codificado en base64 (<span className="font-mono text-ink">base64 -w0 llave.json</span>), y reinicia el servicio. Si la variable existe, el panel la usa y no pide pegar nada.
                </p>
              </div>
              <p className="text-[15px] font-semibold text-ink">Opción B: pegarla aquí (se guarda cifrada)</p>
            </div>
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
                hint="Se comprueba con Google al guardar: si la llave no sirve, te lo dice aquí mismo. No se vuelve a mostrar."
              />
            </ActionForm>
          </details>
        ) : null}

        {google.configured && google.source === "panel" ? <ActionForm action={clearGoogleAccountAction} submitLabel="Quitar la cuenta" pendingLabel="Quitando…" variant="ghost" /> : null}
      </Card>
      ) : null}

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
