import { formatCount } from "@/lib/seo-format";
import { ActionForm } from "@/lib/ui/components/action-form";
import { Badge } from "@/lib/ui/components/badge";
import { Card } from "@/lib/ui/components/card";
import { CheckboxField, Field } from "@/lib/ui/components/field";
import type { MarketSuggestion, SeoMarket } from "@/server/services/seo-markets";
import { addMarketAction, removeMarketAction } from "../actions";

/**
 * Idiomas del sitio. Se declara cada idioma con el prefijo de su ruta (`/en`) y el que no lleva prefijo como idioma por
 * defecto; con eso los datos de búsqueda y tráfico se pueden ver por idioma. Los prefijos que aparecen en los datos se
 * sugieren con un solo clic.
 */
export function MarketsCard({ projectId, markets, suggestions }: { projectId: string; markets: SeoMarket[]; suggestions: MarketSuggestion[] }) {
  return (
    <Card
      title="Idiomas del sitio"
      description="Si el sitio separa los idiomas por ruta (/es/, /en/), decláralos y podrás ver los datos de cada uno por separado."
      actions={<Badge tone={markets.length > 0 ? "ok" : "neutral"}>{markets.length > 0 ? `${markets.length} ${markets.length === 1 ? "idioma" : "idiomas"}` : "Sin declarar"}</Badge>}
    >
      {markets.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
          {markets.map((m) => (
            <li key={m.lang} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-[17px] font-semibold text-ink">
                  {m.label} <span className="font-mono text-[15px] font-normal text-ink-muted">({m.lang})</span>
                </span>
                <span className="text-[15px] text-ink-muted">
                  {m.isDefault ? (
                    "Idioma por defecto: las páginas que no tienen otro prefijo"
                  ) : (
                    <>
                      Páginas que empiezan por <span className="font-mono text-ink">{m.prefix}</span>
                    </>
                  )}
                </span>
              </div>
              <ActionForm action={removeMarketAction.bind(null, projectId, m.lang)} submitLabel="Quitar" pendingLabel="Quitando…" variant="ghost" />
            </li>
          ))}
        </ul>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface-100 p-3 md:p-4">
          <p className="text-[15px] leading-5 text-ink-muted">Encontré estos prefijos de idioma en tus datos. Agrégalos con un clic:</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((sg) => (
              <li key={sg.prefix} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[15px] text-ink">
                  <span className="font-mono">{sg.prefix}</span> → {sg.label}{" "}
                  <span className="text-ink-muted">
                    ({formatCount(sg.clicks)} clics · {formatCount(sg.sessions)} sesiones)
                  </span>
                </span>
                <ActionForm action={addMarketAction.bind(null, projectId)} submitLabel={`Agregar ${sg.label}`} pendingLabel="Agregando…" variant="secondary">
                  <input type="hidden" name="market_lang" value={sg.lang} />
                  <input type="hidden" name="market_prefix" value={sg.prefix} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="rounded-sm border border-border p-4" open={markets.length === 0 && suggestions.length === 0}>
        <summary className="cursor-pointer text-[19px] font-semibold text-ink">Agregar un idioma</summary>
        <ActionForm action={addMarketAction.bind(null, projectId)} submitLabel="Agregar idioma" pendingLabel="Agregando…" resetOnSuccess className="mt-4 max-w-xl">
          <Field label="Idioma (código)" id="market_lang" required placeholder="en" maxLength={3} autoComplete="off" spellCheck={false} hint="Dos letras: es, en, pt, fr… Solo el idioma, sin el país (no es-MX)." />
          <Field label="Prefijo de la ruta" id="market_prefix" placeholder="/en" autoComplete="off" spellCheck={false} hint="Cómo empiezan las direcciones de ese idioma. Déjalo vacío si marcas el idioma por defecto." />
          <CheckboxField label="Es el idioma por defecto" id="market_default" hint="Sus páginas no llevan prefijo (por ejemplo, la portada «/» en español). Solo puede haber uno." />
        </ActionForm>
      </details>
    </Card>
  );
}
