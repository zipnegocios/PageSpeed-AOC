"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Button } from "@/lib/ui/components/button";
import { Field } from "@/lib/ui/components/field";

/**
 * Eliminación definitiva: pide escribir el nombre exacto y mantiene el botón apagado hasta que coincide.
 * Qué se pierde se explica en `consequence`, en palabras llanas.
 */
export function DeleteConfirmForm({
  action,
  name,
  consequence,
  label,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  name: string;
  consequence: string;
  label: string;
}) {
  const [typed, setTyped] = useState("");
  return (
    <ActionForm action={action} className="mt-3">
      <p className="text-[15px] leading-5 text-ink">{consequence}</p>
      <Field
        label={`Escribe «${name}» para confirmar`}
        id="confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <div>
        <Button type="submit" variant="danger" disabled={typed.trim() !== name}>
          {label}
        </Button>
      </div>
    </ActionForm>
  );
}
