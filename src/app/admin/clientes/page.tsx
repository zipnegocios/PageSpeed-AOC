import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/auth/session";
import { clientPath } from "@/lib/urls";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { Field, TextareaField } from "@/lib/ui/components/field";
import { listClients } from "@/server/services/clients";
import { AdminShell } from "../_components/admin-shell";
import { createClientAction } from "./actions";

export const metadata: Metadata = { title: "Clientes · AOC PageSpeed", robots: { index: false, follow: false } };

export default async function ClientsPage() {
  const session = await verifySession();
  const clients = await listClients();

  return (
    <AdminShell email={session.email} title="Clientes" crumbs={[{ label: "Panel", href: "/admin" }]}>
      <Card title="Tus clientes" description="Cada cliente agrupa sus proyectos y tiene un link propio de solo lectura.">
        {clients.length === 0 ? (
          <p className="text-ink-muted">Todavía no hay clientes. Crea el primero con el formulario de abajo.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={clientPath(c.slug)}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 hover:bg-surface-300"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[19px] font-semibold break-words text-ink">{c.name}</span>
                    <span className="text-[15px] text-ink-muted">
                      {c.contactEmail ?? "Sin correo de contacto"} · {c.projectCount}{" "}
                      {c.projectCount === 1 ? "proyecto" : "proyectos"}
                    </span>
                  </span>
                  <Badge tone={c.status === "active" ? "ok" : "danger"}>{c.status === "active" ? "Activo" : "Suspendido"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[15px] text-ink-muted">
          ¿Buscas uno que archivaste? Está en{" "}
          <Link href="/admin/archivados" className="font-semibold text-link hover:underline">
            Archivados
          </Link>
          .
        </p>
      </Card>

      <details open={clients.length === 0} className="glass rounded-lg p-4 md:p-6">
        <summary className="cursor-pointer text-[24px] leading-7 font-semibold text-ink">Nuevo cliente</summary>
        <ActionForm action={createClientAction} submitLabel="Crear cliente" pendingLabel="Creando…" className="mt-4">
          <Field label="Nombre" id="name" required maxLength={120} autoComplete="off" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Persona de contacto" id="contactName" maxLength={120} autoComplete="off" />
            <Field label="Correo de contacto" id="contactEmail" type="email" autoComplete="off" hint="Aquí llegarán las alertas del cliente." />
            <Field label="Teléfono / WhatsApp" id="contactPhone" type="tel" autoComplete="off" hint="Con prefijo del país, p. ej. +34 600 123 456." />
            <Field
              label="Identificador (opcional)"
              id="slug"
              maxLength={40}
              autoComplete="off"
              hint="Minúsculas, números y guiones. Si lo dejas vacío se genera del nombre. No se puede cambiar después."
            />
          </div>
          <TextareaField label="Notas internas" id="notes" maxLength={2000} />
        </ActionForm>
      </details>
    </AdminShell>
  );
}
