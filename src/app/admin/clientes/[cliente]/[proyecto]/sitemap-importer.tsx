"use client";

import { startTransition, useActionState, useState } from "react";
import type { ActionState, SitemapCandidate } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Button } from "@/lib/ui/components/button";

type Props = {
  discover: (prev: ActionState) => Promise<ActionState>;
  importRoutes: (prev: ActionState, formData: FormData) => Promise<ActionState>;
};

// Constante a nivel de módulo: useActionState devuelve este mismo objeto en el servidor en
// cada pasada de renderizado, así que no puede ser un literal nuevo por render.
const INITIAL: ActionState = {};

/** Busca rutas en el sitemap y deja elegir cuáles activar para monitoreo. */
export function SitemapImporter({ discover, importRoutes }: Props) {
  const [found, dispatch, searching] = useActionState<ActionState, void>(discover, INITIAL);
  // Cada búsqueda reinicia la lista de candidatas (y su selección) mediante `key`.
  const [run, setRun] = useState(0);

  function search() {
    setRun((n) => n + 1);
    startTransition(() => dispatch());
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="secondary" disabled={searching} onClick={search}>
          {searching ? "Buscando…" : "Buscar rutas en el sitemap"}
        </Button>
      </div>
      {found.error ? <Alert tone="danger">{found.error}</Alert> : null}
      {found.ok ? <Alert tone="info">{found.ok}</Alert> : null}
      {found.candidates && found.candidates.length > 0 ? (
        <CandidateList key={run} candidates={found.candidates} importRoutes={importRoutes} />
      ) : null}
    </div>
  );
}

function CandidateList({ candidates, importRoutes }: { candidates: SitemapCandidate[]; importRoutes: Props["importRoutes"] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.map((c) => c.path)));
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Tras importar, la lista se reemplaza por la confirmación (si se desmontara, el mensaje se perdería).
  if (doneMessage) return <Alert tone="info">{`${doneMessage} Usa «Primer escaneo» (abajo) para auditarlas en móvil y escritorio.`}</Alert>;

  return (
    <ActionForm
      action={async (prev, fd) => {
        const result = await importRoutes(prev, fd);
        if (result.ok) setDoneMessage(result.ok);
        return result;
      }}
      submitLabel={`Activar ${selected.size} ${selected.size === 1 ? "ruta" : "rutas"}`}
      pendingLabel="Activando…"
    >
      <div className="flex flex-wrap gap-4 text-[15px]">
        <button type="button" className="font-semibold text-link hover:underline" onClick={() => setSelected(new Set(candidates.map((c) => c.path)))}>
          Marcar todas
        </button>
        <button type="button" className="font-semibold text-link hover:underline" onClick={() => setSelected(new Set())}>
          Quitar todas
        </button>
      </div>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-sm border border-border">
        {candidates.map((c) => (
          <li key={c.path}>
            <label className="flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-surface-300">
              <input
                type="checkbox"
                name="path"
                value={c.path}
                checked={selected.has(c.path)}
                onChange={() => toggle(c.path)}
                className="size-5 accent-primary"
              />
              <span className="font-mono text-[14px] break-all text-ink">{c.path}</span>
            </label>
          </li>
        ))}
      </ul>
    </ActionForm>
  );
}
