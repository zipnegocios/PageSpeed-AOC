"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import { removeClientLogoAction, setClientLogoBgAction, uploadClientLogoAction } from "@/app/admin/clientes/actions";
import type { ActionState } from "@/lib/actions";
import { logoBlob, isLogoType } from "@/lib/image/logo-blob";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Button } from "@/lib/ui/components/button";
import { ClientLogo, adminLogoUrl } from "@/lib/ui/components/client-logo";

const NO_STATE: ActionState = {};

type Slot = { kind: "icon" | "full"; title: string; hint: string; tile: string };
const SLOTS: Slot[] = [
  { kind: "icon", title: "Isotipo (icono)", hint: "Cuadrado o casi. Es el icono de la app instalada (con el rayo de PageSpeed encima) y va en las celdas pequeñas.", tile: "size-28" },
  { kind: "full", title: "Logotipo completo", hint: "Con el nombre, de cualquier proporción (apaisado, vertical…). Va en el resumen del portal y en los informes en PDF.", tile: "h-28 w-56" },
];

function LogoSlot({ clientId, name, slot, present, bg, v }: { clientId: string; name: string; slot: Slot; present: boolean; bg: string | null; v: number }) {
  const [upload, uploadDispatch, uploading] = useActionState<ActionState, FormData>(uploadClientLogoAction.bind(null, clientId, slot.kind), NO_STATE);
  const [remove, removeDispatch, removing] = useActionState<ActionState, FormData>(async (prev) => removeClientLogoAction(clientId, slot.kind, prev), NO_STATE);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `logo-file-${slot.kind}`;

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    setFileName(file.name);
    if (!isLogoType(file.type)) {
      setError("Usa una imagen PNG, JPEG, WebP, GIF o SVG.");
      return;
    }
    try {
      const out = await logoBlob(file, slot.kind);
      setBlob(out);
      setPreview(URL.createObjectURL(out));
    } catch {
      setError("No se pudo leer esa imagen. Prueba con otra.");
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!blob) return;
    const data = new FormData();
    data.set("logo", blob, `${slot.kind}.png`);
    startTransition(() => uploadDispatch(data));
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-sm border border-border p-4">
      <h3 className="text-[19px] leading-6 font-semibold text-ink">{slot.title}</h3>
      <ClientLogo src={preview ?? (present ? adminLogoUrl(clientId, slot.kind, v) : null)} name={name} bg={bg} className={slot.tile} alt={`${slot.title} de ${name}`} />
      <p className="text-[15px] leading-5 text-ink-muted">{slot.hint}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input id={id} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={onPick} className="peer sr-only" />
          <label htmlFor={id} className="press inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong px-4 text-[17px] font-semibold text-ink hover:bg-surface-300 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
            Elegir imagen
          </label>
          <span className="min-w-0 truncate text-[15px] text-ink-muted">{fileName ?? "Ninguna imagen elegida"}</span>
        </div>
        <p className="text-[14px] leading-5 text-ink-muted">PNG, JPEG, WebP, GIF o SVG. Se convierte a PNG con transparencia antes de subirla; no se recorta.</p>
        <div>
          <Button type="submit" disabled={!blob || uploading}>
            {uploading ? "Subiendo…" : present ? "Reemplazar" : "Guardar"}
          </Button>
        </div>
      </form>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {upload.error ? <Alert tone="danger">{upload.error}</Alert> : null}
      {upload.ok ? <Alert tone="info">{upload.ok}</Alert> : null}
      {present ? (
        <form action={removeDispatch}>
          <Button type="submit" variant="ghost" disabled={removing}>
            {removing ? "Quitando…" : "Quitar"}
          </Button>
        </form>
      ) : null}
      {remove.error ? <Alert tone="danger">{remove.error}</Alert> : null}
    </div>
  );
}

/** Logotipo del cliente: isotipo y logotipo completo, y el color de fondo para los que son claros o blancos. */
export function ClientLogoUploader({ clientId, name, icon, full, bg, v }: { clientId: string; name: string; icon: boolean; full: boolean; bg: string | null; v: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {SLOTS.map((slot) => (
          <LogoSlot key={slot.kind} clientId={clientId} name={name} slot={slot} present={slot.kind === "icon" ? icon : full} bg={bg} v={v} />
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-sm border border-border p-4">
        <h3 className="text-[19px] leading-6 font-semibold text-ink">Color de fondo</h3>
        <p className="text-[15px] leading-5 text-ink-muted">
          Para un logotipo blanco o muy claro, elige un fondo que se vea (p. ej. el azul de la marca). Se aplica a los dos y a los recuadros del portal, del panel y de los informes. Sin color, el fondo es blanco.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <ActionForm action={setClientLogoBgAction.bind(null, clientId)} submitLabel="Guardar color" pendingLabel="Guardando…" className="max-w-xs">
            <label htmlFor="logo-bg" className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">
              Color
            </label>
            <input id="logo-bg" name="bg" type="color" defaultValue={bg ?? "#ffffff"} className="h-11 w-24 cursor-pointer rounded-sm border border-border-strong bg-surface-100 p-1" />
          </ActionForm>
          {bg ? (
            <ActionForm action={setClientLogoBgAction.bind(null, clientId)} submitLabel="Quitar color" pendingLabel="Quitando…" variant="ghost">
              <input type="hidden" name="bg" value="" />
            </ActionForm>
          ) : null}
        </div>
      </div>
    </div>
  );
}
