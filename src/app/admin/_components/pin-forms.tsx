"use client";

import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";

type Action = (prev: ActionState) => Promise<ActionState>;

/** Botones para generar el PIN del cliente. El PIN nuevo aparece enseguida en «PIN actual». */
export function PinForms({ generate, generateAndEmail, canEmail }: { generate: Action; generateAndEmail: Action; canEmail: boolean }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <ActionForm action={generate} submitLabel="Generar PIN" pendingLabel="Generando…" variant="secondary" />
      {canEmail ? <ActionForm action={generateAndEmail} submitLabel="Generar y enviar al correo del cliente" pendingLabel="Enviando…" variant="secondary" /> : null}
    </div>
  );
}
