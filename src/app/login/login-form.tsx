"use client";

import { useActionState } from "react";
import { Alert } from "@/lib/ui/components/alert";
import { Button } from "@/lib/ui/components/button";
import { Field } from "@/lib/ui/components/field";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        label="Correo"
        id="email"
        type="email"
        autoComplete="username"
        defaultValue={state.email}
        required
        autoFocus
      />
      <Field label="Contraseña" id="password" type="password" autoComplete="current-password" required />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
