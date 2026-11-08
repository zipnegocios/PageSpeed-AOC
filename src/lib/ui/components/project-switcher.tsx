"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterProjectItems, type SwitcherItem } from "@/lib/project-search";

const isEditable = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
};

/**
 * Ir a cualquier proyecto sin pasar por los clientes. Se abre con el botón, con "/" o con Ctrl/Cmd+K; busca por proyecto o
 * por cliente (sin acentos); flechas para moverse, Enter para abrir, Esc para cerrar. Usa un <dialog> nativo: atrapa el
 * foco, deja inerte lo de detrás y lo devuelve al botón al cerrar.
 */
export function ProjectSwitcher({ items }: { items: SwitcherItem[] }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => filterProjectItems(items, query), [items, query]);
  const optionId = (i: number) => `${listId}-o${i}`;

  function open() {
    const d = dialogRef.current;
    if (!d || d.open) return;
    setQuery("");
    setActive(0);
    d.showModal();
    inputRef.current?.focus();
  }
  function go(item: SwitcherItem | undefined) {
    if (!item) return;
    dialogRef.current?.close();
    router.push(item.href);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialogRef.current?.open) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") {
        e.preventDefault();
        open();
      } else if (k === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (dialogRef.current?.open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  });

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-keyshortcuts="/ Control+K Meta+K"
        className="press hud-flat inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-[17px] font-semibold text-ink hover:border-primary"
      >
        <svg viewBox="0 0 24 24" className="size-5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <span>Ir a un proyecto</span>
        <kbd className="hidden rounded-sm border border-border-strong px-1.5 font-mono text-[13px] text-ink-muted md:inline">/</kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Ir a un proyecto"
        onClick={(e) => e.target === dialogRef.current && dialogRef.current.close()}
        className="hud m-auto mt-[12vh] w-[min(92vw,36rem)] max-w-none overflow-hidden rounded-lg p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex flex-col">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
            aria-label="Buscar proyecto o cliente"
            placeholder="Buscar proyecto o cliente…"
            autoComplete="off"
            spellCheck={false}
            className="min-h-14 w-full border-b border-border bg-transparent px-4 text-[19px] text-ink placeholder:text-ink-muted"
          />
          <ul id={listId} role="listbox" aria-label="Proyectos" className="max-h-[50vh] overflow-y-auto p-2">
            {results.map((item, i) => (
              <li key={item.id} role="presentation">
                {!query && (i === 0 || results[i - 1]!.clientName !== item.clientName) ? (
                  <div className="px-3 pt-3 pb-1 text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{item.clientName}</div>
                ) : null}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={() => go(item)}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 ${i === active ? "bg-primary text-on-primary" : ""}`}
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{item.name}</span>
                    {query ? <span className={i === active ? "" : "text-ink-muted"}> · {item.clientName}</span> : null}
                  </span>
                  <span className={`shrink-0 text-[13px] font-semibold tracking-[0.08em] uppercase ${i === active ? "" : "text-ink-muted"}`}>{item.phase === "production" ? "Producción" : "Desarrollo"}</span>
                </div>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className={`px-4 py-3 text-[15px] text-ink-muted ${results.length === 0 ? "" : "sr-only"}`}>
            {results.length === 0 ? `Ningún proyecto coincide con «${query}».` : `${results.length} ${results.length === 1 ? "proyecto" : "proyectos"}`}
          </p>
        </div>
      </dialog>
    </>
  );
}
