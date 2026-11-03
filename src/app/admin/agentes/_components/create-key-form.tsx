"use client";

import { createApiKeyAction } from "../actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Field } from "@/lib/ui/components/field";
import { SecretReveal } from "./secret-reveal";

export type PresetOption = { id: string; label: string; description: string };

export function CreateKeyForm({ presets }: { presets: PresetOption[] }) {
  return (
    <ActionForm
      action={createApiKeyAction}
      submitLabel="Crear clave"
      pendingLabel="Creando…"
      resetOnSuccess
      className="max-w-xl"
      renderResult={(state) => (state.secret ? <SecretReveal secret={state.secret} /> : null)}
    >
      <Field label="Nombre del agente" id="name" required minLength={2} maxLength={60} autoComplete="off" hint="Para reconocerlo después, por ejemplo «Claude de Gustavo»." />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Permisos</legend>
        {presets.map((p, i) => (
          <label key={p.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-subtle">
            <input type="radio" name="preset" value={p.id} defaultChecked={i === 0} className="mt-1 size-5 accent-primary" />
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{p.label}</span>
              <span className="text-[15px] leading-5 text-ink-muted">{p.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </ActionForm>
  );
}
