import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { formatDate } from "@/lib/audit-format";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { listTeam } from "@/server/services/team";
import { AdminShell } from "../_components/admin-shell";
import { resendInviteAction, revokeInviteAction, removeMemberAction, sendResetAction } from "./actions";
import { InviteForm } from "./_components/invite-form";
import { LinkAction, RemoveMember } from "./_components/member-actions";

export const metadata: Metadata = { title: pageTitle("Equipo"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await verifySession();
  // Solo el propietario gestiona el equipo: para los demás la página no existe.
  if (session.role !== "owner") notFound();
  const team = await listTeam(session);

  return (
    <AdminShell email={session.email} title="Equipo" subtitle="Quién puede entrar al panel." crumbs={[{ label: "Panel", href: "/admin" }]}>
      <Card title="Invitar a una persona" description="Todas las personas del equipo administran clientes, proyectos, agentes y cola. Solo tú agregas o quitas personas.">
        <InviteForm />
      </Card>

      <Card title={`Equipo (${team.members.length})`} description="Cuentas con acceso al panel.">
        <ul className="divide-y divide-border rounded-sm border border-border">
          {team.members.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold break-all text-ink">{m.email}</span>
                <Badge tone={m.role === "owner" ? "primary" : "neutral"}>{m.role === "owner" ? "Propietario" : "Administrador"}</Badge>
                {m.id === session.id ? <Badge>Tú</Badge> : null}
              </div>
              <p className="text-[15px] text-ink-muted">Desde {formatDate(m.createdAt)}</p>
              {m.role === "owner" ? null : (
                <div className="flex flex-wrap items-start gap-3">
                  <LinkAction action={sendResetAction.bind(null, m.id)} label="Enviar enlace de contraseña nueva" pendingLabel="Enviando…" />
                  <RemoveMember action={removeMemberAction.bind(null, m.id)} email={m.email} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Invitaciones pendientes (${team.invites.length})`} description="Enlaces que todavía no se usaron. Vencen a los 7 días.">
        {team.invites.length === 0 ? (
          <p className="text-ink-muted">No hay invitaciones pendientes.</p>
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {team.invites.map((i) => (
              <li key={i.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold break-all text-ink">{i.email}</span>
                  <Badge>{i.kind === "reset" ? "Contraseña nueva" : "Invitación pendiente"} · vence el {formatDate(i.expiresAt)}</Badge>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                  <LinkAction action={resendInviteAction.bind(null, i.id)} label="Reenviar" pendingLabel="Enviando…" />
                  <ActionForm action={revokeInviteAction.bind(null, i.id)} submitLabel="Revocar" pendingLabel="Revocando…" variant="ghost" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminShell>
  );
}
