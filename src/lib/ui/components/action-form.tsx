"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions";
import { Alert } from "@/lib/ui/components/alert";
import { Button } from "@/lib/ui/components/button";
import { cx } from "@/lib/ui/cx";

// Mismo objeto en cada render: en el servidor useActionState devuelve el estado inicial tal cual.
const NO_STATE: ActionState = {};

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Texto del botón. Si se omite, el formulario no muestra botón (lo ponen los hijos). */
  submitLabel?: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  /** Vacía los campos cuando la acción termina bien (p. ej. "agregar ruta"). */
  resetOnSuccess?: boolean;
  className?: string;
  /** Contenido extra bajo los mensajes, según el resultado (solo desde componentes de cliente). */
  renderResult?: (state: ActionState) => ReactNode;
  children?: ReactNode;
};

/**
 * Formulario para Server Actions. Envía por onSubmit en lugar de `action={...}`: así React
 * no vacía los campos cuando hay un error de validación y la persona no pierde lo escrito.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Guardando…",
  variant = "primary",
  resetOnSuccess = false,
  className,
  renderResult,
  children,
}: Props) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, NO_STATE);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className={cx("flex flex-col gap-4", className)}>
      {children}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="info">{state.ok}</Alert> : null}
      {renderResult ? renderResult(state) : null}
      {submitLabel ? (
        <div>
          <Button type="submit" variant={variant} disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
