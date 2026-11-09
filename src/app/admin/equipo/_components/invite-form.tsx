"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import type { ActionState } from "@/lib/actions";
import { Alert } from "@/lib/ui/components/alert";
import { Avatar } from "@/lib/ui/components/avatar";
import { Button } from "@/lib/ui/components/button";
import { Field } from "@/lib/ui/components/field";
import { isAvatarType, squareBlob } from "@/lib/image/square-blob";
import { SecretReveal } from "@/app/admin/agentes/_components/secret-reveal";
import { inviteMemberAction } from "../actions";

const NO_STATE: ActionState = {};
const OPTION = "flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-subtle";
// Sin caracteres que se confunden al dictarlos (0/O, 1/l/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 16 caracteres aleatorios del navegador (criptográficamente seguros). */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * Dar de alta a una persona con su perfil completo: correo, nombre, apellido y foto (todo menos el correo es opcional), y
 * cómo entra: con un enlace de un solo uso por correo, o con una cuenta que se crea ahora con una contraseña provisional.
 */
export function InviteForm() {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(inviteMemberAction, NO_STATE);
  // Tras crear a alguien, los campos se vacían (se vuelve a montar el formulario) y el resultado se queda a la vista.
  const [seen, setSeen] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setGeneration((g) => g + 1);
  }
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <InviteFields key={generation} dispatch={dispatch} pending={pending} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="info">{state.ok}</Alert> : null}
      {state.secret ? <SecretReveal secret={state.secret} what={/^https?:\/\//.test(state.secret) ? "enlace" : "contraseña"} /> : null}
    </div>
  );
}

function InviteFields({ dispatch, pending }: { dispatch: (data: FormData) => void; pending: boolean }) {
  const [access, setAccess] = useState<"email" | "password">("email");
  const [password, setPassword] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPhotoError(null);
    if (!file) return;
    setFileName(file.name);
    if (!isAvatarType(file.type)) {
      setPhotoError("La foto debe ser PNG, JPEG o WebP.");
      return;
    }
    try {
      const out = await squareBlob(file);
      setBlob(out);
      setPreview(URL.createObjectURL(out));
    } catch {
      setPhotoError("No se pudo leer esa imagen. Prueba con otra.");
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (blob) data.set("avatar", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
    startTransition(() => dispatch(data));
  }

  const initials = [first, last].map((x) => x.trim()[0]).filter(Boolean).join("").toUpperCase() || email.trim()[0]?.toUpperCase() || "?";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Correo de la persona" id="email" type="email" required autoComplete="off" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" id="firstName" autoComplete="off" maxLength={60} value={first} onChange={(e) => setFirst(e.target.value)} />
        <Field label="Apellido" id="lastName" autoComplete="off" maxLength={60} value={last} onChange={(e) => setLast(e.target.value)} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Avatar initials={initials} src={preview} size="lg" />
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Foto (opcional)</span>
          <div className="flex flex-wrap items-center gap-3">
            <input id="invite-avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} className="peer sr-only" />
            <label htmlFor="invite-avatar" className="press inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border-strong px-4 text-[17px] font-semibold text-ink hover:bg-surface-300 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
              Elegir foto
            </label>
            <span className="text-[15px] text-ink-muted">{fileName ?? "Ninguna foto elegida"}</span>
          </div>
        </div>
      </div>
      {photoError ? <Alert tone="danger">{photoError}</Alert> : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Cómo entra</legend>
        <label className={OPTION}>
          <input type="radio" name="access" value="email" checked={access === "email"} onChange={() => setAccess("email")} className="mt-1 size-5 accent-primary" />
          <span className="flex flex-col">
            <span className="font-semibold text-ink">Enlace por correo</span>
            <span className="text-[15px] leading-5 text-ink-muted">Le llega un enlace de un solo uso, válido por 7 días, para crear su contraseña.</span>
          </span>
        </label>
        <label className={OPTION}>
          <input type="radio" name="access" value="password" checked={access === "password"} onChange={() => setAccess("password")} className="mt-1 size-5 accent-primary" />
          <span className="flex flex-col">
            <span className="font-semibold text-ink">Contraseña provisional</span>
            <span className="text-[15px] leading-5 text-ink-muted">La cuenta se crea ahora. Dale tú esta contraseña; podrá cambiarla en su perfil.</span>
          </span>
        </label>
        {access === "password" ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <Field
                label="Contraseña provisional"
                id="password"
                required
                minLength={12}
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono"
                hint="Al menos 12 caracteres. Se muestra una sola vez al crearla."
              />
            </div>
            <Button type="button" variant="ghost" onClick={() => setPassword(generatePassword())}>
              Generar
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enviando…" : access === "password" ? "Crear cuenta" : "Enviar invitación"}
        </Button>
      </div>
    </form>
  );
}
