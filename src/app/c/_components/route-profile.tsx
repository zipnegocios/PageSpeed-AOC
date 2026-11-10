"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cx } from "@/lib/ui/cx";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { ProfileTabs, type ProfileTab } from "@/lib/ui/components/profile-tabs";
import { Score } from "@/lib/ui/components/score";
import type { Profile, ProfileScores } from "@/server/domain/route-tree";
import { Hint } from "./hint";

/**
 * El dispositivo (móvil o escritorio) que se está mirando en una fila de Rutas. Lo comparten la cinta de arriba (R·S·A·B·IA, que vive en el
 * resumen de la fila) y las pestañas del detalle, así que al cambiar de dispositivo cambian a la vez las notas de arriba y las métricas de abajo.
 */
const Ctx = createContext<{ profile: Profile; setProfile: (p: Profile) => void } | null>(null);

export function RouteProfileProvider({ initial, children }: { initial: Profile; children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(initial);
  return <Ctx.Provider value={{ profile, setProfile }}>{children}</Ctx.Provider>;
}

const STRIP = [
  ["performance", "R"],
  ["seo", "S"],
  ["accessibility", "A"],
  ["best_practices", "B"],
] as const;

const cell = (dashed: boolean) => cx("flex min-w-0 flex-col items-center overflow-hidden rounded-md bg-surface-100 py-1", dashed && "border border-dashed border-border-strong bg-transparent");

/** La cinta de cinco indicadores de una fila, del dispositivo elegido; cada celda explica qué mide al tocarla. */
export function RouteStrip({ mobile, desktop, dashed = false }: { mobile: ProfileScores | null; desktop: ProfileScores | null; dashed?: boolean }) {
  const ctx = useContext(Ctx);
  const wanted = ctx?.profile ?? (mobile ? "mobile" : "desktop");
  // Si la página no tiene el dispositivo elegido, se enseña el que sí tiene.
  const data = (wanted === "mobile" ? mobile : desktop) ?? mobile ?? desktop;
  const agentic = data?.agentic ?? null;
  const agenticText = agentic && agentic.total > 0 ? `${agentic.passed}/${agentic.total}` : null;
  return (
    <div className={cx("grid grid-cols-5 gap-1 min-[360px]:gap-1.5", dashed && "opacity-90")}>
      {STRIP.map(([key, letter]) => (
        <Hint key={key} k={letter} value={data?.scores[key] ?? null} className={cell(dashed)}>
          <span aria-hidden className="text-[11px] leading-3 font-semibold text-ink-muted">
            {letter}
          </span>
          <Score value={data?.scores[key] ?? null} className="text-[17px] leading-5" />
        </Hint>
      ))}
      <Hint k="IA" value={agenticText} className={cell(dashed)}>
        <span aria-hidden className="text-[11px] leading-3 font-semibold text-ink-muted">
          IA
        </span>
        <AgenticFraction value={agentic} className={cx("leading-5 tracking-tight whitespace-nowrap", (agentic?.total ?? 0) > 99 ? "text-[11px]" : "text-[14px]")} />
      </Hint>
    </div>
  );
}

/** Las pestañas Móvil / Escritorio del detalle de una página, ligadas al dispositivo de la fila. */
export function RouteProfileTabs({ tabs, label, defaultProfile }: { tabs: ProfileTab[]; label: string; defaultProfile: Profile }) {
  const ctx = useContext(Ctx);
  return <ProfileTabs label={label} defaultProfile={defaultProfile} tabs={tabs} value={ctx?.profile} onChange={ctx?.setProfile} />;
}
