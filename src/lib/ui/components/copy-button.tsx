"use client";

import { useState } from "react";
import { Button } from "@/lib/ui/components/button";

/** Copia un texto al portapapeles. Si el navegador lo impide, pide copiarlo a mano. */
export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span className="inline-flex items-center gap-3">
      <Button variant="secondary" onClick={copy}>
        {state === "copied" ? "Copiado" : label}
      </Button>
      {state === "error" ? <span className="text-[15px] text-ink-muted">No se pudo copiar: selecciona el texto.</span> : null}
    </span>
  );
}
