"use client";

import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Button } from "@/lib/ui/components/button";
import { KeyFields, type PresetOption, type ScopeClient } from "@/app/admin/agentes/_components/key-fields";
import { authorizeAction, denyAction } from "./actions";

/** Los permisos y el alcance que se otorgan, con «Autorizar» y «Cancelar». La solicitud original se pasa para revalidarla en el servidor. */
export function ConsentForm({ query, presets, clients }: { query: Record<string, string>; presets: PresetOption[]; clients: ScopeClient[] }) {
  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={authorizeAction.bind(null, query) as (prev: ActionState, fd: FormData) => Promise<ActionState>} submitLabel="Autorizar" pendingLabel="Autorizando…" className="max-w-xl">
        <Alert tone="info">Verá y hará solo lo que marques abajo. Podrás cambiarlo o revocarlo cuando quieras en Agentes.</Alert>
        <KeyFields prefix="oauth" presets={presets} clients={clients} hideName />
      </ActionForm>
      <form action={denyAction.bind(null, query)}>
        <Button type="submit" variant="secondary">
          Cancelar
        </Button>
      </form>
    </div>
  );
}
