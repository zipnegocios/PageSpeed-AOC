"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

const MenuContext = createContext<{ close: () => void }>({ close: () => undefined });

const ITEM = "flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-[17px] font-semibold focus:bg-surface-300 focus:outline-none hover:bg-surface-300";

/**
 * Menú desplegable accesible: botón con `aria-haspopup` y `aria-expanded`, panel con `role="menu"`. Se cierra con Esc, con
 * un clic fuera o al salir con Tab; las flechas, Inicio y Fin recorren los elementos y el foco vuelve al botón.
 */
export function Menu({
  label,
  trigger,
  children,
  active = false,
  triggerClassName,
  panelClassName,
}: {
  /** Nombre accesible del botón. */
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  /** Marca el botón como la sección actual (anillo lima). */
  active?: boolean;
  triggerClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    // Esc cierra aunque el foco siga en el botón (se abrió con el ratón).
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  function focusItem(index: number) {
    const list = items();
    if (list.length === 0) return;
    list[(index + list.length) % list.length]?.focus();
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const target = e.key === "ArrowDown" ? 0 : -1;
      if (open) {
        focusItem(target);
      } else {
        setOpen(true);
        // El panel se pinta en el siguiente ciclo.
        requestAnimationFrame(() => focusItem(target));
      }
    }
  }

  function onPanelKey(e: KeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === "Tab") {
      close();
    }
  }

  return (
    <MenuContext.Provider value={{ close: () => close() }}>
      <div ref={root} className="relative">
        <button
          ref={button}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKey}
          className={cx(
            "press inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-surface-300 hover:text-ink",
            active && "text-ink ring-2 ring-primary",
            triggerClassName,
          )}
        >
          {trigger}
        </button>
        {open ? (
          <div
            ref={panel}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onPanelKey}
            className={cx("hud hud-brackets absolute top-full right-0 z-50 mt-2 max-w-[calc(100vw-2rem)] min-w-64 rounded-lg py-2 shadow-none", panelClassName)}
          >
            {children}
          </div>
        ) : null}
      </div>
    </MenuContext.Provider>
  );
}

/** Un enlace del menú. Cierra el menú al elegirlo. */
export function MenuLink({ href, children, current = false, className }: { href: string; children: ReactNode; current?: boolean; className?: string }) {
  const { close } = useContext(MenuContext);
  return (
    <Link role="menuitem" tabIndex={-1} href={href} aria-current={current ? "page" : undefined} onClick={close} className={cx(ITEM, "text-ink", current && "bg-surface-300", className)}>
      {children}
    </Link>
  );
}

/** Un botón del menú (dentro de un `<form>` para las acciones del servidor). */
export function MenuButton({ children, className, type = "submit" }: { children: ReactNode; className?: string; type?: "submit" | "button" }) {
  return (
    <button role="menuitem" tabIndex={-1} type={type} className={cx(ITEM, className)}>
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className="my-2 border-t border-border" />;
}
