"use client";

import { inviteMemberAction } from "../actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Field } from "@/lib/ui/components/field";
import { SecretReveal } from "@/app/admin/agentes/_components/secret-reveal";

/** Invitar por correo. El enlace sale una sola vez por si el correo no llega. */
export function InviteForm() {
  return (
    <ActionForm
      action={inviteMemberAction}
      submitLabel="Enviar invitación"
      pendingLabel="Enviando…"
      resetOnSuccess
      className="max-w-xl"
      renderResult={(state) => (state.secret ? <SecretReveal secret={state.secret} /> : null)}
    >
      <Field label="Correo de la persona" id="email" type="email" required autoComplete="off" maxLength={200} hint="Le llega un enlace de un solo uso, válido por 7 días, para crear su contraseña." />
    </ActionForm>
  );
}
