"use client";

import { useState } from "react";
import { Field } from "@/lib/ui/components/field";

export type PresetOption = { id: string; label: string; description: string };
export type ScopeClient = { id: string; name: string; projects: Array<{ id: string; name: string }> };
export type KeyFieldValues = { name: string; preset: string | null; all: boolean; clientIds: string[]; projectIds: string[] };

const OPTION = "flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-subtle";

/**
 * Los campos de una clave: nombre, permisos y alcance. Los comparten «Nueva clave» y «Editar». `prefix` hace únicos los
 * `id` cuando hay varios formularios en la página (cada fila de la lista tiene el suyo).
 */
export function KeyFields({
  prefix,
  presets,
  clients,
  initial,
  hideName = false,
}: {
  prefix: string;
  presets: PresetOption[];
  clients: ScopeClient[];
  initial?: KeyFieldValues;
  /** Sin el campo de nombre (la pantalla de autorización lo deriva de la aplicación). */
  hideName?: boolean;
}) {
  const [access, setAccess] = useState<"selected" | "all">(initial?.all ? "all" : "selected");
  const first = initial ? initial.preset : presets[0]?.id;
  return (
    <>
      {hideName ? null : <Field label="Nombre del agente" id={`${prefix}-name`} name="name" defaultValue={initial?.name} required minLength={2} maxLength={60} autoComplete="off" hint="Para reconocerlo después, por ejemplo «Claude de Gustavo»." />}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Permisos</legend>
        {presets.map((p) => (
          <label key={p.id} className={OPTION}>
            <input type="radio" name="preset" value={p.id} defaultChecked={first === p.id} required className="mt-1 size-5 accent-primary" />
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{p.label}</span>
              <span className="text-[15px] leading-5 text-ink-muted">{p.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Alcance</legend>
        <label className={OPTION}>
          <input type="radio" name="access" value="selected" checked={access === "selected"} onChange={() => setAccess("selected")} className="mt-1 size-5 accent-primary" />
          <span className="flex flex-col">
            <span className="font-semibold text-ink">Solo lo que elija</span>
            <span className="text-[15px] leading-5 text-ink-muted">El agente solo ve y toca los clientes y proyectos que marques abajo. Lo demás ni siquiera existe para él.</span>
          </span>
        </label>
        <label className={OPTION}>
          <input type="radio" name="access" value="all" checked={access === "all"} onChange={() => setAccess("all")} className="mt-1 size-5 accent-primary" />
          <span className="flex flex-col">
            <span className="font-semibold text-ink">Todos los clientes y proyectos</span>
            <span className="text-[15px] leading-5 text-ink-muted">Incluye los que crees después. Úsalo solo para un agente de confianza que atienda toda la cuenta.</span>
          </span>
        </label>
        {access === "selected" ? (
          clients.length === 0 ? (
            <p className="text-[15px] text-ink-muted">Aún no hay clientes. Crea uno primero, o elige acceso total.</p>
          ) : (
            <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-sm border border-border p-3">
              {clients.map((c) => (
                <div key={c.id} className="flex flex-col gap-1">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input type="checkbox" name="clientIds" value={c.id} defaultChecked={initial?.clientIds.includes(c.id)} className="mt-1 size-5 accent-primary" />
                    <span className="flex flex-col">
                      <span className="font-semibold text-ink">{c.name}</span>
                      <span className="text-[14px] leading-5 text-ink-muted">Todos sus proyectos, también los futuros</span>
                    </span>
                  </label>
                  {c.projects.length > 0 ? (
                    <div className="ml-8 flex flex-col">
                      {c.projects.map((p) => (
                        <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                          <input type="checkbox" name="projectIds" value={p.id} defaultChecked={initial?.projectIds.includes(p.id)} className="size-5 accent-primary" />
                          <span className="text-[17px] text-ink">Solo {p.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </fieldset>
    </>
  );
}
