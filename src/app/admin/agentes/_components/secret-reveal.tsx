"use client";

import { Alert } from "@/lib/ui/components/alert";
import { CopyButton } from "@/lib/ui/components/copy-button";

/** Muestra una credencial una sola vez: bloque seleccionable que se parte en líneas, y botón de copiar. */
export function SecretReveal({ secret }: { secret: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-border-strong p-3">
      <Alert tone="info">Copia la clave ahora: no se vuelve a mostrar.</Alert>
      <code className="block rounded-sm bg-surface-300 p-3 font-mono text-[14px] break-all text-ink select-all">{secret}</code>
      <div>
        <CopyButton value={secret} label="Copiar clave" />
      </div>
    </div>
  );
}
