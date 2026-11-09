"use client";

import { startTransition, useActionState, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { ActionState } from "@/lib/actions";
import { Alert } from "@/lib/ui/components/alert";
import { Avatar } from "@/lib/ui/components/avatar";
import { Button } from "@/lib/ui/components/button";
import { isAvatarType, squareBlob } from "@/lib/image/square-blob";
import { removeAvatarAction, uploadAvatarAction } from "../actions";

const NO_STATE: ActionState = {};

export function AvatarUploader({ initials, src }: { initials: string; src: string | null }) {
  const [upload, uploadDispatch, uploading] = useActionState<ActionState, FormData>(uploadAvatarAction, NO_STATE);
  const [remove, removeDispatch, removing] = useActionState<ActionState, FormData>(async (prev) => removeAvatarAction(prev), NO_STATE);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    setFileName(file.name);
    if (!isAvatarType(file.type)) {
      setError("La foto debe ser PNG, JPEG o WebP.");
      return;
    }
    try {
      const out = await squareBlob(file);
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
    data.set("avatar", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
    startTransition(() => uploadDispatch(data));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar initials={initials} src={preview ?? src} size="lg" className="size-24 text-[32px]" />
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Foto</span>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={input} id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} className="peer sr-only" />
            <label htmlFor="avatar-file" className="press inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong px-4 text-[17px] font-semibold text-ink hover:bg-surface-300 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
              Elegir foto
            </label>
            <span className="text-[15px] text-ink-muted">{fileName ?? "Ninguna foto elegida"}</span>
          </div>
          <p className="text-[15px] leading-5 text-ink-muted">PNG, JPEG o WebP. Se recorta en cuadrado y se reduce antes de subirla.</p>
          <div>
            <Button type="submit" disabled={!blob || uploading}>
              {uploading ? "Subiendo…" : "Guardar foto"}
            </Button>
          </div>
        </form>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {upload.error ? <Alert tone="danger">{upload.error}</Alert> : null}
      {upload.ok ? <Alert tone="info">{upload.ok}</Alert> : null}
      {src ? (
        <form action={removeDispatch}>
          <Button type="submit" variant="ghost" disabled={removing}>
            {removing ? "Quitando…" : "Quitar foto"}
          </Button>
        </form>
      ) : null}
      {remove.error ? <Alert tone="danger">{remove.error}</Alert> : null}
      {remove.ok ? <Alert tone="info">{remove.ok}</Alert> : null}
    </div>
  );
}
