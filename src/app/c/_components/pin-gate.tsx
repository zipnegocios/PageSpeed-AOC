import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Card } from "@/lib/ui/components/card";
import { Field } from "@/lib/ui/components/field";
import { requestPinAction, verifyPinAction } from "../actions";
import { PortalShell } from "./portal-shell";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Lo que ve el cliente antes de entrar. Es igual para cualquier dirección, exista o no el cliente. */
export function PinGate({ verify, requestNew }: { verify: Action; requestNew: (prev: ActionState) => Promise<ActionState> }) {
  return (
    <PortalShell title="Tu informe">
      <Card title="Escribe tu PIN" description="Es el PIN de 6 dígitos que te dieron para ver tu informe.">
        <ActionForm action={verify} submitLabel="Entrar" pendingLabel="Entrando…" className="max-w-xs">
          <Field
            label="PIN"
            id="pin"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            autoFocus
            spellCheck={false}
            className="font-mono text-[28px] tracking-[0.4em]"
          />
        </ActionForm>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-[15px] leading-5 text-ink-muted">¿No lo tienes o no te funciona? Te enviamos uno nuevo al correo registrado. Los PIN anteriores dejan de funcionar.</p>
          <ActionForm action={requestNew} submitLabel="Enviar un PIN nuevo a mi correo" pendingLabel="Enviando…" variant="secondary" />
        </div>
      </Card>
    </PortalShell>
  );
}

/** La pantalla del PIN para el enlace `/c/<slug>` que se está abriendo. */
export function PinGateFor({ slug }: { slug: string }) {
  return <PinGate verify={verifyPinAction.bind(null, slug)} requestNew={requestPinAction.bind(null, slug)} />;
}
