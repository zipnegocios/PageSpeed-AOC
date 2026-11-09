"use client";

import { createApiKeyAction } from "../actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { KeyFields, type PresetOption, type ScopeClient } from "./key-fields";
import { SecretReveal } from "./secret-reveal";

export type { PresetOption, ScopeClient } from "./key-fields";

export function CreateKeyForm({ presets, clients }: { presets: PresetOption[]; clients: ScopeClient[] }) {
  return (
    <ActionForm
      action={createApiKeyAction}
      submitLabel="Crear clave"
      pendingLabel="Creando…"
      resetOnSuccess
      className="max-w-xl"
      renderResult={(state) => (state.secret ? <SecretReveal secret={state.secret} /> : null)}
    >
      <KeyFields prefix="new" presets={presets} clients={clients} />
    </ActionForm>
  );
}
