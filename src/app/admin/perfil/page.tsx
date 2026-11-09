import type { Metadata } from "next";
import { pageTitle } from "@/lib/brand";
import { verifySession } from "@/lib/auth/session";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { avatarUrl } from "@/lib/ui/components/avatar";
import { Card } from "@/lib/ui/components/card";
import { Field } from "@/lib/ui/components/field";
import { initials } from "@/server/domain/profile";
import { AdminShell } from "../_components/admin-shell";
import { changePasswordAction, updateProfileAction } from "./actions";
import { AvatarUploader } from "./_components/avatar-uploader";

export const metadata: Metadata = { title: pageTitle("Mi perfil"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await verifySession();
  return (
    <AdminShell title="Mi perfil" subtitle={session.email} crumbs={[{ label: "Panel", href: "/admin" }]}>
      {session.provisionalPassword ? <Alert tone="info">Estás usando una contraseña provisional. Cámbiala por una tuya.</Alert> : null}
      <Card title="Foto" description="Se ve en el menú de la barra superior. Solo la ve el equipo.">
        <AvatarUploader initials={initials(session)} src={avatarUrl(session.id, session.avatarKey)} />
      </Card>

      <Card title="Datos personales" description="Cómo te ve el resto del equipo. Son opcionales: sin nombre se usa tu correo.">
        <ActionForm action={updateProfileAction} submitLabel="Guardar" pendingLabel="Guardando…" className="max-w-xl">
          <Field label="Nombre" id="firstName" defaultValue={session.firstName ?? ""} maxLength={60} autoComplete="given-name" />
          <Field label="Apellido" id="lastName" defaultValue={session.lastName ?? ""} maxLength={60} autoComplete="family-name" />
        </ActionForm>
      </Card>

      <Card title="Contraseña" description="Cerraremos tus otras sesiones abiertas; esta sigue abierta.">
        <ActionForm action={changePasswordAction} submitLabel="Cambiar contraseña" pendingLabel="Cambiando…" resetOnSuccess className="max-w-xl">
          <input type="email" name="username" value={session.email} autoComplete="username" readOnly hidden />
          <Field label="Contraseña actual" id="current" type="password" autoComplete="current-password" required maxLength={200} />
          <Field label="Contraseña nueva" id="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} hint="Al menos 12 caracteres." />
          <Field label="Repite la contraseña nueva" id="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
        </ActionForm>
      </Card>
    </AdminShell>
  );
}
