"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/lib/ui/components/action-form";
import { CheckboxField, TextareaField } from "@/lib/ui/components/field";
import { cx } from "@/lib/ui/cx";
import {
  ccAddresses,
  CcParseError,
  DEFAULT_SERVICES,
  greetingNames,
  parseCcContacts,
  SERVICE_KEYS,
  SERVICE_LABEL,
  SOLUTION_SUGGESTIONS,
  TECH_SUGGESTIONS,
  type ServiceKey,
} from "@/server/domain/client-welcome";
import { welcomeOpening } from "@/server/notify/client-emails";

export type WelcomeProductRow = {
  id: string;
  name: string;
  /** Dirección que se muestra en el correo. */
  site: string;
  solutions: string[];
  techs: string[];
  services: string[];
  initialImprovement: boolean;
};

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  products: WelcomeProductRow[];
  contactName: string | null;
  contactEmail: string;
  initialCc: string;
  /** Quien firma (el responsable del cliente), para la vista previa. */
  sender: { name: string; brand: string; service: string; whatsapp: string | null; email: string | null };
};

type Row = WelcomeProductRow & { include: boolean };

const chipClass = "inline-flex items-center gap-1 rounded-sm bg-primary-subtle py-0.5 pr-1 pl-2 text-[15px] text-on-primary-subtle";

/** Etiquetas libres con sugerencias: escribes y pulsas Enter (o coma), o eliges una sugerencia. Nada obliga a usar la lista. */
function TagInput({ id, label, values, onChange, groups, placeholder }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void; groups: ReadonlyArray<{ group: string; items: string[] }>; placeholder: string }) {
  const [text, setText] = useState("");
  const have = values.map((v) => v.toLowerCase());
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || have.includes(t.toLowerCase())) return;
    onChange([...values, t]);
  };
  const q = text.trim().toLowerCase();
  const all = groups.flatMap((g) => g.items).filter((x) => !have.includes(x.toLowerCase()));
  const suggestions = q ? all.filter((x) => x.toLowerCase().includes(q)).slice(0, 12) : groups.flatMap((g) => g.items.filter((x) => !have.includes(x.toLowerCase())).slice(0, 2)).slice(0, 12);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-sm border border-border-strong bg-surface-100 px-2 py-1.5 focus-within:outline-2 focus-within:outline-primary">
        {values.map((v, i) => (
          <span key={v} className={chipClass}>
            {v}
            <button type="button" aria-label={`Quitar ${v}`} className="px-1.5 text-[18px] leading-none" onClick={() => onChange(values.filter((_, k) => k !== i))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
              setText("");
            } else if (e.key === "Backspace" && !text && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => {
            add(text);
            setText("");
          }}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={60}
          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-[17px] text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Sugerencias">
        {suggestions.length === 0 ? (
          <span className="text-[15px] text-ink-muted">{text.trim() ? `Pulsa Enter para agregar «${text.trim()}» tal cual.` : "Escribe lo que quieras."}</span>
        ) : (
          suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-sm border border-dashed border-border-strong px-2 py-0.5 text-[14px] text-ink hover:bg-surface-300"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                add(s);
                setText("");
              }}
            >
              + {s}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Formulario de la bienvenida: un solo correo para todos los productos marcados. Lo que se escribe se guarda en cada proyecto. */
export function WelcomeForm({ action, products, contactName, contactEmail, initialCc, sender }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    products.map((p, i) => ({ ...p, include: i === 0 || products.length === 1, services: p.services.length > 0 ? p.services : [...DEFAULT_SERVICES] })),
  );
  const [cc, setCc] = useState(initialCc);
  const [test, setTest] = useState(false);
  const patch = (i: number, p: Partial<Row>) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const included = rows.filter((r) => r.include);

  let summary: string;
  let names: string[] = [];
  try {
    const contacts = parseCcContacts(cc, [contactEmail]);
    names = greetingNames(contactName, contacts);
    const copy = ccAddresses(contacts, contactEmail);
    const hello = names.length === 0 || names.length > 3 ? "Hola equipo de [cliente]" : `Hola ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`}`;
    summary = `Para: ${contactEmail}${copy.length > 0 ? ` · Copia: ${copy.join(", ")}` : ""}. Saludo: «${hello},».`;
  } catch (err) {
    summary = err instanceof CcParseError ? err.message : "Revisa la lista de personas en copia.";
  }

  const payload = JSON.stringify(
    included.map((r) => ({ projectId: r.id, solutions: r.solutions, techs: r.techs, services: r.services, initialImprovement: r.initialImprovement })),
  );
  const preview = included.length > 0 ? welcomeOpening({ names: names.length > 0 ? names : ["Ana"], products: included.map((r) => ({ site: r.site, solutions: r.solutions.length > 0 ? r.solutions : ["…"], techs: r.techs, services: r.services })), sender }) : [];

  return (
    <ActionForm action={action} submitLabel={test ? "Enviarme una prueba" : "Enviar bienvenida"} pendingLabel="Enviando…" variant={test ? "secondary" : "primary"}>
      <input type="hidden" name="products" value={payload} />
      <p className="text-[15px] leading-5 text-ink-muted">
        Un solo correo y un solo PIN para todos los productos que marques. Para cada uno escribes con tus palabras qué es y en qué está hecho (las sugerencias ayudan, pero puedes escribir lo que quieras) y qué incluye tu servicio: el correo solo promete lo que marcas.
      </p>
      {rows.map((r, i) => (
        <fieldset key={r.id} className={cx("flex flex-col gap-4 rounded-sm border border-border p-4", !r.include && "opacity-60")}>
          <legend className="px-1">
            <label className="flex items-center gap-3 text-[19px] font-semibold text-ink">
              <input type="checkbox" className="size-5 accent-primary" checked={r.include} onChange={(e) => patch(i, { include: e.target.checked })} />
              {r.name} <span className="text-[15px] font-normal text-ink-muted">· {r.site}</span>
            </label>
          </legend>
          {r.include ? (
            <>
              <TagInput id={`sol-${r.id}`} label="Qué es" values={r.solutions} onChange={(v) => patch(i, { solutions: v })} groups={SOLUTION_SUGGESTIONS} placeholder="Tienda online, app móvil, CRM, chatbot…" />
              <TagInput id={`tec-${r.id}`} label="Tecnología" values={r.techs} onChange={(v) => patch(i, { techs: v })} groups={TECH_SUGGESTIONS} placeholder="WordPress, Next.js, Flutter, PostgreSQL…" />
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Qué incluye tu servicio en este producto</span>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {SERVICE_KEYS.map((k: ServiceKey) => (
                    <label key={k} className="flex min-h-9 items-center gap-2 text-[16px] text-ink">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={r.services.includes(k)}
                        onChange={(e) => patch(i, { services: e.target.checked ? [...r.services, k] : r.services.filter((x) => x !== k) })}
                      />
                      {SERVICE_LABEL[k]}
                    </label>
                  ))}
                </div>
              </div>
              <CheckboxField
                label="En mejora inicial"
                id={`mej-${r.id}`}
                checked={r.initialImprovement}
                onChange={(e) => patch(i, { initialImprovement: e.target.checked })}
                hint="Los valores de este producto son el punto de partida y se van a corregir en las próximas semanas. Mientras esté marcado, el portal, los PDF y el correo mensual lo explican con un aviso para que el cliente no se alarme. Se apaga a mano en la ficha del proyecto."
              />
            </>
          ) : null}
        </fieldset>
      ))}
      <TextareaField
        label="Personas en copia (opcional)"
        id="ccText"
        rows={3}
        value={cc}
        onChange={(e) => setCc(e.target.value)}
        placeholder={"Luis Vega <luis@empresa.com>\nMaría Soto <maria@empresa.com>"}
        hint="Una persona por línea. Si alguien comparte tu dirección de contacto (o la de otra persona), escríbela igual con su nombre: se nombran las dos en el saludo y el correo llega una sola vez. Se guarda para los próximos correos."
      />
      <p className="text-[15px] leading-5 text-ink-muted">{summary}</p>
      {preview.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-sm border-l-4 border-primary bg-surface-300 p-4 text-[16px] leading-6 text-ink">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Así se leerá la apertura</span>
          {preview.map((b, k) =>
            b.k === "p" ? (
              <p key={k}>{b.t.replace(/\*\*/g, "")}</p>
            ) : b.k === "list" ? (
              <ul key={k} className="list-disc pl-5">
                {b.items.map((it) => (
                  <li key={it}>{it.replace(/\*\*/g, "")}</li>
                ))}
              </ul>
            ) : null,
          )}
        </div>
      ) : (
        <p className="text-[15px] text-ink">Marca al menos un producto.</p>
      )}
      <CheckboxField
        label="Enviarme solo una prueba"
        id="test"
        checked={test}
        onChange={(e) => setTest(e.target.checked)}
        hint="Llega a tu correo de administrador con estos mismos datos. No se envía al cliente ni se guarda nada."
      />
    </ActionForm>
  );
}
