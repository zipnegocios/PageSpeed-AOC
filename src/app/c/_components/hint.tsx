"use client";

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/ui/cx";
import { METRIC_HINTS, readHint, type HintKey, type HintTone } from "@/server/domain/metric-hints";

const OPEN_EVENT = "portal-hint-open";
const DOT: Record<HintTone, string> = { ok: "bg-ok", warning: "bg-warning", danger: "bg-danger", none: "bg-ink-muted" };
const PILL: Record<HintTone, string> = {
  ok: "bg-ok-subtle text-on-ok-subtle",
  warning: "bg-surface-300 text-ink ring-1 ring-inset ring-warning",
  danger: "bg-danger-subtle text-on-danger-subtle",
  none: "bg-surface-300 text-ink-muted",
};
const GAP = 10;
const EDGE = 10;

type Place = { left: number; top: number; above: boolean; arrow: number };

/**
 * Una sigla o un valor con su explicación: una burbuja propia (no el aviso del sistema) que dice qué se mide, cómo se lee cada rango y cómo está
 * el valor actual. Se abre con el cursor, con el foco del teclado y con el toque (en el teléfono no hay cursor); se cierra al tocar fuera, al
 * desplazar o con Esc, y solo hay una abierta a la vez. Dentro de un `<summary>` el toque abre la burbuja sin plegar ni desplegar la fila.
 */
export function Hint({ k, value, className, children }: { k: HintKey; /** El valor que se está leyendo; sin él la burbuja solo explica la sigla. */ value?: number | string | null; className?: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  // Dónde se dibuja la burbuja: dentro de `.portal` (ahí viven los colores del tema), o en el cuerpo si no hubiera.
  const [root, setRoot] = useState<Element | null>(null);
  const def = METRIC_HINTS[k];
  const reading = value === undefined ? null : readHint(k, value);

  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
  }, []);
  const show = useCallback(() => {
    setRoot(trigger.current?.closest(".portal") ?? document.body);
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(true);
  }, [id]);

  // Solo una abierta a la vez; se cierra al tocar fuera, con Esc, al desplazar o al cambiar el tamaño.
  useEffect(() => {
    if (!open) return;
    const onOther = (e: Event) => (e as CustomEvent).detail !== id && close();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !bubble.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener(OPEN_EVENT, onOther);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOther);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, id, close]);

  // Coloca la burbuja arriba (o abajo si no cabe) y la mantiene dentro de la pantalla; la flecha sigue apuntando a la sigla.
  useEffect(() => {
    if (!open || !trigger.current || !bubble.current) return;
    const t = trigger.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const above = t.top - b.height - GAP > 64;
    const center = t.left + t.width / 2;
    const left = Math.max(EDGE, Math.min(window.innerWidth - b.width - EDGE, center - b.width / 2));
    setPlace({ left, top: above ? t.top - b.height - GAP : t.bottom + GAP, above, arrow: Math.max(14, Math.min(b.width - 28, center - left - 7)) });
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className={cx("hint-trigger cursor-help", open && "bg-surface-300", className)}
        onClick={(e: MouseEvent) => {
          // Dentro de un resumen desplegable, tocar la sigla no debe plegar ni desplegar la fila.
          e.preventDefault();
          e.stopPropagation();
          // Con cursor, la burbuja ya se abrió al pasar por encima: el clic no debe cerrarla. Con el dedo, tocar alterna.
          if (window.matchMedia("(hover: hover)").matches) show();
          else if (open) close();
          else show();
        }}
        onMouseEnter={() => window.matchMedia("(hover: hover)").matches && show()}
        onMouseLeave={() => window.matchMedia("(hover: hover)").matches && close()}
        // Solo el foco del teclado abre la burbuja: el que llega con un toque o un clic lo maneja el propio toque.
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()}
        onBlur={close}
      >
        {children}
      </button>
      {open && root
        ? createPortal(
            <div
              ref={bubble}
              id={id}
              role="tooltip"
              style={{ position: "fixed", left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
              className="pointer-events-none z-[70] w-[min(18.5rem,calc(100vw-1.25rem))] rounded-2xl bg-surface-200 p-3.5 text-left text-[14px] leading-5 text-ink shadow-[0_0_0_1px_rgba(17,24,39,0.06),0_12px_32px_rgba(17,24,39,0.22)]"
            >
              <span
                aria-hidden
                className="absolute size-3.5 rotate-45 bg-surface-200"
                style={{ left: place?.arrow ?? 0, ...(place?.above ? { bottom: -7 } : { top: -7 }) }}
              />
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <span className="inline-flex h-[22px] min-w-[26px] items-center justify-center rounded-md bg-primary px-1.5 text-[12px] text-on-primary">{def.sigla}</span>
                {def.name}
              </p>
              <p className="mt-1 mb-2.5 text-ink-muted">{def.text}</p>
              {def.ranges ? (
                <ul className="flex flex-col gap-1 rounded-xl bg-surface-100 px-2.5 py-2 text-[13px]">
                  {(["ok", "warning", "danger"] as const).map((tone, i) => (
                    <li key={tone} className="flex items-center gap-2">
                      <span aria-hidden className={cx("size-2 shrink-0 rounded-full", DOT[tone])} />
                      {def.ranges![i]} · {["bueno", "mejorable", "deficiente"][i]}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-surface-100 px-2.5 py-2 text-[13px]">Se muestra como «superadas / totales»: no cambia colores ni genera alertas.</p>
              )}
              {reading ? (
                <p className="mt-2.5 flex items-center justify-between gap-2 text-[14px] font-semibold">
                  <span>Tu valor: {reading.valueText}</span>
                  <span className={cx("rounded-full px-2.5 py-0.5 text-[13px]", PILL[reading.tone])}>{reading.word}</span>
                </p>
              ) : null}
            </div>,
            root,
          )
        : null}
    </>
  );
}
