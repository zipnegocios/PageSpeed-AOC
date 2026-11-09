"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Button } from "@/lib/ui/components/button";
import { SecretReveal } from "@/app/admin/agentes/_components/secret-reveal";

type Action = (prev: ActionState) => Promise<ActionState>;

/** Una acción que puede devolver un enlace (se muestra una sola vez). */
export function LinkAction({ action, label, pendingLabel }: { action: Action; label: string; pendingLabel: string }) {
  return (
    <ActionForm
      action={action}
      submitLabel={label}
      pendingLabel={pendingLabel}
      variant="ghost"
      className="flex-col items-start gap-2"
      renderResult={(state) => (state.secret ? <SecretReveal secret={state.secret} /> : null)}
    />
  );
}

/** Quitar a alguien pide confirmar: el primer clic arma el botón, el segundo lo ejecuta. */
export function RemoveMember({ action, email }: { action: Action; email: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button type="button" variant="ghost" onClick={() => setArmed(true)}>
        Quitar
      </Button>
    );
  }
  return (
    <ActionForm action={action} submitLabel="Sí, quitar" pendingLabel="Quitando…" variant="danger" className="flex-col items-start gap-2">
      <p className="text-[15px] leading-5 text-ink">
        Quitar a <strong>{email}</strong>. Ya no podrá entrar y su sesión actual se cierra.
      </p>
    </ActionForm>
  );
}
