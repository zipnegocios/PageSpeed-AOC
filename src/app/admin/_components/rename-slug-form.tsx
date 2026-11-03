import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Alert } from "@/lib/ui/components/alert";
import { Field } from "@/lib/ui/components/field";

/** Cambio de identificador (slug), plegado por defecto. Explica qué cambia y qué no antes de pedir el valor nuevo. */
export function RenameSlugForm({
  action,
  current,
  what,
  aliases,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  current: string;
  what: "cliente" | "proyecto";
  aliases: string[];
}) {
  return (
    <details className="rounded-sm border border-border p-4">
      <summary className="cursor-pointer text-[19px] font-semibold text-ink">
        Identificador: <span className="font-mono">{current}</span> · cambiar
      </summary>
      <ActionForm action={action} submitLabel="Cambiar identificador" pendingLabel="Cambiando…" className="mt-4 max-w-xl">
        <Alert tone="info">
          Cambia las direcciones de este {what} y la carpeta de sus informes nuevos. Los enlaces anteriores siguen funcionando y los informes ya guardados se quedan donde están.
        </Alert>
        <Field
          label="Identificador nuevo"
          id="slug"
          required
          minLength={2}
          maxLength={40}
          defaultValue={current}
          autoComplete="off"
          spellCheck={false}
          hint="Minúsculas, números y guiones, de 2 a 40 caracteres."
        />
        {aliases.length > 0 ? (
          <p className="text-[15px] leading-5 text-ink-muted">
            Identificadores anteriores (siguen funcionando y quedan reservados): <span className="font-mono">{aliases.join(", ")}</span>
          </p>
        ) : null}
      </ActionForm>
    </details>
  );
}
