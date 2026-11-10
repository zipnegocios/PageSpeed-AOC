import { ActionForm } from "@/lib/ui/components/action-form";
import type { ActionState } from "@/lib/actions";
import type { ShareMember } from "@/server/services/team-access";

/** Casillas para elegir con quién se comparte un cliente o un proyecto. Una persona marcada lo ve y lo opera; no puede compartirlo ni archivarlo. */
export function ShareForm({
  members,
  checked,
  action,
  emptyText,
}: {
  members: ShareMember[];
  checked: string[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  emptyText: string;
}) {
  if (members.length === 0) return <p className="text-[15px] leading-5 text-ink-muted">{emptyText}</p>;
  const on = new Set(checked);
  return (
    <ActionForm action={action} submitLabel="Guardar" pendingLabel="Guardando…" variant="secondary" className="max-w-xl">
      <ul className="flex flex-col">
        {members.map((m) => (
          <li key={m.id}>
            <label className="flex min-h-11 items-center gap-3 text-[17px] text-ink">
              <input type="checkbox" name="member" value={m.id} defaultChecked={on.has(m.id)} className="size-5 accent-primary" />
              <span className="min-w-0 break-words">
                {m.name}
                {m.name !== m.email ? <span className="text-[15px] text-ink-muted"> · {m.email}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </ActionForm>
  );
}
