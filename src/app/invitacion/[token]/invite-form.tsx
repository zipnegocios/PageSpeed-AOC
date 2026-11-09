"use client";

import { acceptInviteAction } from "../actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Field } from "@/lib/ui/components/field";

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  return (
    <ActionForm action={acceptInviteAction.bind(null, token)} submitLabel="Crear contraseña y entrar" pendingLabel="Entrando…" className="max-w-sm">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Correo</span>
        <code className="block rounded-sm bg-surface-300 p-3 font-mono text-[14px] break-all text-ink">{email}</code>
      </div>
      {/* El gestor de contraseñas del navegador necesita ver el correo como usuario de este formulario. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field label="Contraseña" id="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} hint="Al menos 12 caracteres." />
      <Field label="Repite la contraseña" id="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
    </ActionForm>
  );
}
