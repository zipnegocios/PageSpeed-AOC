"use client";

import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { SecretReveal } from "@/app/admin/agentes/_components/secret-reveal";

type Action = (prev: ActionState) => Promise<ActionState>;

/** Botones para generar el PIN del cliente. El PIN nuevo se muestra una sola vez. */
export function PinForms({ generate, generateAndEmail, canEmail }: { generate: Action; generateAndEmail: Action; canEmail: boolean }) {
  const reveal = (state: ActionState) => (state.secret ? <SecretReveal secret={state.secret} what="PIN" large /> : null);
  return (
    <div className="flex flex-col items-start gap-4">
      <ActionForm action={generate} submitLabel="Generar PIN" pendingLabel="Generando…" variant="secondary" renderResult={reveal} />
      {canEmail ? (
        <ActionForm action={generateAndEmail} submitLabel="Generar y enviar al correo del cliente" pendingLabel="Enviando…" variant="secondary" renderResult={reveal} />
      ) : null}
    </div>
  );
}
