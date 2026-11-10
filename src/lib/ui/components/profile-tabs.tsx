"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/ui/cx";

export type ProfileTab = {
  profile: "mobile" | "desktop";
  label: string;
  /** Lo que acompaña al nombre en la pestaña: la puntuación, "En curso", "Falló"… */
  badge?: ReactNode;
  /** El contenido del panel, ya renderizado en el servidor. */
  content: ReactNode;
};

/**
 * Las dos pestañas de una página: Móvil y Escritorio. Los dos paneles llegan ya renderizados y solo se alterna cuál se ve,
 * así que cambiar no pide nada al servidor. Ratón, tacto o teclado: flechas para alternar, Inicio y Fin para los extremos.
 */
export function ProfileTabs({
  tabs,
  defaultProfile,
  label,
  value,
  onChange,
}: {
  tabs: ProfileTab[];
  defaultProfile: "mobile" | "desktop";
  label: string;
  /** Con `value`, el perfil lo decide quien llama (otra parte de la pantalla lo comparte); sin él, el componente lleva su propio estado. */
  value?: "mobile" | "desktop";
  onChange?: (profile: "mobile" | "desktop") => void;
}) {
  const base = useId();
  const [own, setOwn] = useState<"mobile" | "desktop">(tabs.some((t) => t.profile === defaultProfile) ? defaultProfile : tabs[0]!.profile);
  const active = value && tabs.some((t) => t.profile === value) ? value : own;
  const setActive = (p: "mobile" | "desktop") => {
    setOwn(p);
    onChange?.(p);
  };
  const refs = useRef<Partial<Record<"mobile" | "desktop", HTMLButtonElement | null>>>({});
  const tabId = (p: string) => `${base}-tab-${p}`;
  const panelId = (p: string) => `${base}-panel-${p}`;

  function move(to: "mobile" | "desktop") {
    setActive(to);
    refs.current[to]?.focus();
  }
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.findIndex((t) => t.profile === active);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(tabs[(i + 1) % tabs.length]!.profile);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(tabs[(i - 1 + tabs.length) % tabs.length]!.profile);
    else if (e.key === "Home") move(tabs[0]!.profile);
    else if (e.key === "End") move(tabs[tabs.length - 1]!.profile);
    else return;
    e.preventDefault();
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const selected = t.profile === active;
          return (
            <button
              key={t.profile}
              ref={(el) => {
                refs.current[t.profile] = el;
              }}
              id={tabId(t.profile)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(t.profile)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.profile)}
              onKeyDown={onKeyDown}
              className={cx(
                "press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-[17px] font-semibold",
                selected ? "border-primary bg-primary text-on-primary" : "border-border bg-surface-300 text-ink-muted hover:text-ink",
              )}
            >
              <span>{t.label}</span>
              {/* Sobre el relleno lima la puntuación (lima, ámbar o roja) no se leería: va en una pastilla navy. */}
              {t.badge ? <span className={cx("inline-flex items-center rounded-sm", selected && "bg-surface-100 px-1.5")}>{t.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.profile} id={panelId(t.profile)} role="tabpanel" aria-labelledby={tabId(t.profile)} hidden={t.profile !== active} tabIndex={0} className="min-w-0">
          {t.content}
        </div>
      ))}
    </div>
  );
}
