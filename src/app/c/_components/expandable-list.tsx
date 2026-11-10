"use client";

import { useId, useState } from "react";
import { ChevronRight } from "./portal-icons";

/** Cuántas causas se enseñan de entrada; el resto queda detrás de «Ver las N restantes». */
export const VISIBLE_ITEMS = 5;

export type ListItem = { id: string; text: string; impact: string; /** Una línea de detalle bajo el texto (p. ej. lo que se encontró en una página). */ note?: string };

function Item({ n, text, impact, note }: { n: number; text: string; impact: string; note?: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-300 text-[13px] font-semibold text-ink-muted tabular-nums">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-[16px] leading-6 break-words text-ink">
        {text}
        {note ? <span className="block text-[14px] leading-5 text-ink-muted">{note}</span> : null}
      </span>
      {impact ? <span className="shrink-0 pt-0.5 text-[14px] font-semibold text-danger tabular-nums">{impact}</span> : null}
    </li>
  );
}

/**
 * La lista numerada de causas de un rubro, de la más a la menos importante. Enseña las primeras; el botón queda **debajo de la lista** y la abre
 * entera sin perder la numeración (6, 7, 8…) y luego pasa a «Mostrar solo las 5 primeras». Con pocas causas no hay botón.
 */
export function ExpandableItems({ items, visible = VISIBLE_ITEMS, footer }: { items: ListItem[]; visible?: number; /** Texto bajo la lista cuando hay más de las visibles; `null` lo quita. */ footer?: string | null }) {
  const listId = useId();
  const [all, setAll] = useState(false);
  const extra = items.length - visible;
  const shown = all || extra <= 0 ? items : items.slice(0, visible);
  return (
    <>
      <ol id={listId} className="divide-y divide-border">
        {shown.map((it, i) => (
          <Item key={it.id} n={i + 1} text={it.text} impact={it.impact} note={it.note} />
        ))}
      </ol>
      {extra > 0 ? (
        <button type="button" aria-expanded={all} aria-controls={listId} onClick={() => setAll((v) => !v)} className="press flex min-h-11 items-center gap-1 text-[15px] font-semibold text-link">
          {all ? `Mostrar solo las ${visible} primeras` : `Ver las ${extra} ${extra === 1 ? "restante" : "restantes"}`}
          <ChevronRight className={all ? "-rotate-90" : "rotate-90"} />
        </button>
      ) : null}
      {items.length > visible && footer !== null ? <p className="pb-1 text-[13px] leading-5 text-ink-muted">{footer ?? `${items.length} causas en total, de la más a la menos importante.`}</p> : null}
    </>
  );
}
