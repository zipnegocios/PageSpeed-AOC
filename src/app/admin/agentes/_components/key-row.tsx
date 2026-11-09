"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Badge } from "@/lib/ui/components/badge";
import { Button } from "@/lib/ui/components/button";
import { DeleteConfirmForm } from "@/app/admin/_components/delete-confirm-form";
import { deleteApiKeyAction, revokeApiKeyAction, rotateApiKeyAction, updateApiKeyAction } from "../actions";
import { KeyFields, type KeyFieldValues, type PresetOption, type ScopeClient } from "./key-fields";
import { SecretReveal } from "./secret-reveal";

export type KeyRowData = {
  id: string;
  name: string;
  active: boolean;
  presetLabel: string;
  scopeBadge: string;
  scopeAll: boolean;
  /** Lo que alcanza, en una línea (null si es acceso total). */
  scopeText: string | null;
  created: string;
  lastUsed: string | null;
  rotated: string | null;
  revoked: string | null;
  values: KeyFieldValues;
};

type Action = (prev: ActionState) => Promise<ActionState>;

/** Una acción que no actúa al primer clic: el botón se arma, con la consecuencia dicha en una frase. */
function ConfirmAction({ label, confirmLabel, pendingLabel, consequence, action }: { label: string; confirmLabel: string; pendingLabel: string; consequence: string; action: Action }) {
  const [armed, setArmed] = useState(false);
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(async (prev) => action(prev), {});
  if (state.secret) {
    return (
      <div className="flex w-full flex-col gap-3">
        <Alert tone="info">{state.ok}</Alert>
        <SecretReveal secret={state.secret} />
      </div>
    );
  }
  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;
  if (!armed) {
    return (
      <Button type="button" variant="ghost" onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={dispatch} className="flex max-w-xl flex-col gap-3">
      <p className="text-[15px] leading-5 text-ink">{consequence}</p>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setArmed(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function KeyRow({ k, presets, clients }: { k: KeyRowData; presets: PresetOption[]; clients: ScopeClient[] }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{k.name}</span>
        <Badge tone={k.active ? "ok" : "danger"}>{k.active ? "Activa" : "Revocada"}</Badge>
        <Badge>{k.presetLabel}</Badge>
        <Badge tone={k.scopeAll ? "primary" : "neutral"}>{k.scopeBadge}</Badge>
      </div>
      {k.scopeText ? <p className="text-[15px] text-ink-muted">{k.scopeText}</p> : null}
      <p className="text-[15px] text-ink-muted">
        Creada {k.created} · {k.lastUsed ? `último uso ${k.lastUsed}` : "sin usar todavía"}
        {k.rotated ? ` · rotada ${k.rotated}` : ""}
        {k.revoked ? ` · revocada ${k.revoked}` : ""}
      </p>

      {k.active ? (
        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? "Cerrar edición" : "Editar"}
          </Button>
          <ConfirmAction
            label="Rotar clave"
            confirmLabel="Sí, rotar"
            pendingLabel="Rotando…"
            consequence="La clave actual dejará de funcionar al instante. El agente no podrá conectarse hasta que le pongas la nueva."
            action={rotateApiKeyAction.bind(null, k.id)}
          />
          <ConfirmAction
            label="Revocar"
            confirmLabel="Sí, revocar"
            pendingLabel="Revocando…"
            consequence="El agente que usa esta clave ya no podrá conectarse. Podrás eliminarla de la lista después."
            action={revokeApiKeyAction.bind(null, k.id)}
          />
        </div>
      ) : (
        <details className="rounded-sm border border-border p-3">
          <summary className="cursor-pointer text-[17px] font-semibold text-danger">Eliminar definitivamente</summary>
          <DeleteConfirmForm
            action={deleteApiKeyAction.bind(null, k.id)}
            name={k.name}
            label="Eliminar clave para siempre"
            consequence="Se borra la clave de la lista. No se puede deshacer; las auditorías que lanzó conservan su nombre."
          />
        </details>
      )}

      {k.active && editing ? (
        <div className="mt-2 rounded-sm border border-border p-3">
          <ActionForm action={updateApiKeyAction.bind(null, k.id)} submitLabel="Guardar cambios" pendingLabel="Guardando…" className="max-w-xl">
            <KeyFields prefix={`edit-${k.id}`} presets={presets} clients={clients} initial={k.values} />
            <p className="text-[15px] leading-5 text-ink-muted">Los cambios valen desde la siguiente llamada del agente; la clave no cambia.</p>
          </ActionForm>
        </div>
      ) : null}
    </li>
  );
}
