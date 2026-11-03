import Link from "next/link";
import { AgenticFraction } from "@/lib/ui/components/agentic-fraction";
import { Alert } from "@/lib/ui/components/alert";
import { Card } from "@/lib/ui/components/card";
import { Score } from "@/lib/ui/components/score";
import { SegmentedNav } from "@/lib/ui/components/segmented-nav";
import { StatusMark } from "@/lib/ui/components/status-mark";
import { squarify } from "@/server/domain/treemap";
import { METRIC_FILTERS, type CategoryView, type EvidenceView, type ScriptItem, type SummaryView } from "@/server/domain/lhr-view";
import { AuditRow, CollapsedGroup } from "./audit-row";
import type { DetailsContext } from "./details-block";
import { InlineText } from "./inline-text";

const RATING_WORD = { pass: "bueno", average: "mejorable", fail: "deficiente" } as const;

/** Resumen: notas por categoría, avisos de la medición, captura final, tira de carga y entorno. */
export function SummaryPanel({ summary }: { summary: SummaryView }) {
  return (
    <div className="flex flex-col gap-6">
      {summary.warnings.length > 0 ? (
        <Alert tone="info">
          <strong>Avisos de la medición:</strong> {summary.warnings.join(" ")}
        </Alert>
      ) : null}
      <Card title="Categorías" description={summary.url ? summary.url : undefined}>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {summary.categories.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 rounded-sm border border-border p-3">
              <dt className="text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{c.title}</dt>
              <dd>{c.fraction ? <AgenticFraction value={c.fraction} className="text-[40px] leading-10" hint /> : <Score value={c.score} className="text-[40px] leading-10" />}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {summary.finalScreenshot || summary.filmstrip.length > 0 ? (
        <Card title="Cómo se vio la página" description="Captura final y evolución de la carga.">
          {summary.finalScreenshot ? <ScreenshotFrame src={summary.finalScreenshot} caption="Captura final" width={260} /> : null}
          {summary.filmstrip.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2" role="list" aria-label="Evolución de la carga">
              {summary.filmstrip.map((f, i) => (
                <figure key={i} role="listitem" className="flex shrink-0 flex-col gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.data} alt={`Carga a los ${(f.timing / 1000).toFixed(1)} s`} width={90} className="w-[90px] rounded-sm border border-border" />
                  <figcaption className="text-center text-[14px] text-ink-muted tabular-nums">{(f.timing / 1000).toFixed(1)} s</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
      <EnvironmentStrip items={summary.environment} at={summary.fetchedAt} />
    </div>
  );
}

export function ScreenshotFrame({ src, caption, width }: { src: string; caption: string; width?: number }) {
  return (
    <figure className="flex flex-col gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={caption} style={width ? { maxWidth: width } : undefined} className="w-full rounded-sm border border-border" />
      <figcaption className="text-[14px] text-ink-muted">{caption}</figcaption>
    </figure>
  );
}

export function EnvironmentStrip({ items, at }: { items: Array<{ label: string; value: string }>; at: string | null }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-sm bg-surface-300 p-3 text-[15px] sm:grid-cols-2">
      {[...(at ? [{ label: "Capturado", value: at }] : []), ...items].map((i) => (
        <div key={i.label} className="flex flex-wrap gap-x-2">
          <dt className="text-ink-muted">{i.label}:</dt>
          <dd className="text-ink break-words">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Una categoría completa, como en el informe de Lighthouse. */
export function CategoryPanel({
  category,
  expand,
  metric,
  hrefFor,
  ctx,
  scriptMap,
}: {
  category: CategoryView;
  expand: boolean;
  metric: string | null;
  hrefFor: (patch: Record<string, string | null>) => string;
  ctx: DetailsContext;
  scriptMap?: ScriptItem[];
}) {
  const isPerf = category.id === "performance";
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {category.fraction ? <AgenticFraction value={category.fraction} className="text-[48px] leading-[48px]" hint /> : <Score value={category.score} className="text-[48px] leading-[48px]" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-[24px] leading-7 font-semibold text-ink">{category.title}</h2>
            {category.description ? <p className="text-[15px] leading-5 text-ink-muted"><InlineText text={category.description} /></p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink-muted">
          <span className="flex items-center gap-1"><StatusMark status="fail" /> 0-49</span>
          <span className="flex items-center gap-1"><StatusMark status="average" /> 50-89</span>
          <span className="flex items-center gap-1"><StatusMark status="pass" /> 90-100</span>
          <Link href={hrefFor({ expandir: expand ? null : "1" })} scroll={false} className="ml-auto font-semibold text-link hover:underline">
            {expand ? "Contraer todo" : "Ampliar todo"}
          </Link>
        </div>
      </Card>

      {isPerf && category.metrics.length > 0 ? (
        <Card title="Métricas">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {category.metrics.map((m) => (
              <div key={m.id} className="flex flex-col gap-1 rounded-sm border border-border p-3">
                <dt className="flex items-center gap-2 text-[14px] font-semibold text-ink-muted">
                  <StatusMark status={m.rating} /> {m.title}
                  <span className="sr-only"> ({RATING_WORD[m.rating]})</span>
                </dt>
                <dd className="text-[32px] leading-8 font-bold text-ink tabular-nums">{m.displayValue || "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      {isPerf ? (
        <SegmentedNav
          label="Mostrar auditorías relacionadas con"
          items={[
            { label: "Todas", href: hrefFor({ m: null }), current: !metric },
            ...METRIC_FILTERS.map((m) => ({ label: m, href: hrefFor({ m }), current: metric === m })),
          ]}
        />
      ) : null}

      {category.sections.map((s) => (
        <Card key={s.id} title={s.title || undefined} description={undefined}>
          {s.description ? <p className="-mt-2 text-[15px] leading-5 text-ink-muted"><InlineText text={s.description} /></p> : null}
          <div className="rounded-sm border border-border">
            {s.audits.map((a) => (
              <AuditRow key={a.id} audit={a} open={expand} ctx={ctx} />
            ))}
          </div>
        </Card>
      ))}
      {category.sections.length === 0 ? (
        <Card>
          <p className="text-ink-muted">{metric ? "Ninguna auditoría pendiente se relaciona con esta métrica." : "No hay nada pendiente en esta categoría."}</p>
        </Card>
      ) : null}

      {isPerf && scriptMap && scriptMap.length > 0 ? <ScriptMap items={scriptMap} /> : null}

      <div className="flex flex-col gap-3">
        <CollapsedGroup title="Auditorías aprobadas" audits={category.passed} open={expand} ctx={ctx} />
        <CollapsedGroup title="No aplicables" audits={category.notApplicable} open={expand} ctx={ctx} />
        <CollapsedGroup title="Elementos adicionales que debes comprobar manualmente" audits={category.manual} open={expand} ctx={ctx} />
      </div>
    </div>
  );
}

function kib(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`;
}

/** Mapa de rectángulos de los scripts por tamaño: usado en azul claro, sin usar en rojo claro, y la misma tabla debajo. */
export function ScriptMap({ items }: { items: ScriptItem[] }) {
  const rects = squarify(items.map((i) => ({ name: i.name, value: i.bytes })));
  const byName = new Map(items.map((i) => [i.name, i]));
  return (
    <Card title="Mapa de scripts" description="JavaScript de la página por tamaño. En rojo claro, la parte que no se usa.">
      <div role="img" aria-label={`Mapa de ${items.length} scripts por tamaño`} className="relative h-[280px] w-full overflow-hidden rounded-sm border border-border bg-surface-100">
        {rects.map((r) => {
          const it = byName.get(r.name)!;
          const unusedPct = it.bytes > 0 ? (it.unused / it.bytes) * 100 : 0;
          const big = r.w > 12 && r.h > 12;
          return (
            <div key={r.name} className="absolute overflow-hidden border border-surface-100 bg-primary-subtle" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} title={`${r.name} · ${kib(it.bytes)}`}>
              <div className="absolute inset-x-0 bottom-0 bg-danger-subtle" style={{ height: `${unusedPct}%` }} />
              {big ? <span className="relative block p-1 text-[13px] leading-4 break-all text-on-primary-subtle">{r.name.split("/").pop()}<br />{kib(it.bytes)}</span> : null}
            </div>
          );
        })}
      </div>
      <div className="max-w-full overflow-x-auto rounded-sm border border-border">
        <table className="w-full border-collapse text-left text-[15px]">
          <thead>
            <tr className="bg-surface-300">
              <th className="px-3 py-2 text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Script</th>
              <th className="px-3 py-2 text-right text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Tamaño</th>
              <th className="px-3 py-2 text-right text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Sin usar</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.name}>
                <td className="border-t border-border px-3 py-2 font-mono text-[14px] break-all">{i.name}</td>
                <td className="border-t border-border px-3 py-2 text-right tabular-nums">{kib(i.bytes)}</td>
                <td className="border-t border-border px-3 py-2 text-right tabular-nums">{kib(i.unused)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** La captura de página completa con un recuadro numerado sobre cada elemento de la auditoría elegida. */
export function EvidencePanel({ evidence, imageSrc, selected, hrefFor }: { evidence: NonNullable<EvidenceView>; imageSrc: string; selected: string | null; hrefFor: (audit: string) => string }) {
  if (evidence.audits.length === 0) {
    return (
      <Card title="Evidencias">
        <p className="text-ink-muted">Ninguna auditoría que falle señala elementos concretos de la página.</p>
      </Card>
    );
  }
  const current = evidence.audits.find((a) => a.id === selected) ?? evidence.audits[0]!;
  return (
    <Card title="Evidencias" description="Elige una auditoría para ver sobre la captura qué elementos señala.">
      <SegmentedNav label="Auditoría" items={evidence.audits.map((a) => ({ label: `${a.title.replace(/`/g, "")} (${a.nodes.length})`, href: hrefFor(a.id), current: a.id === current.id }))} />
      <div id="evidencia" className="grid gap-4 md:grid-cols-[minmax(0,420px)_1fr]">
        <div className="relative w-full overflow-hidden rounded-sm border border-border bg-surface-100" style={{ aspectRatio: `${evidence.width} / ${evidence.height}` }} role="img" aria-label={`Captura de la página con ${current.nodes.length} elementos marcados`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt="" className="absolute inset-0 size-full" />
          {current.nodes.map((n) => (
            <div
              key={n.lhId}
              className="absolute border-2 border-danger bg-danger-subtle/40"
              style={{ left: `${(n.rect.left / evidence.width) * 100}%`, top: `${(n.rect.top / evidence.height) * 100}%`, width: `${(n.rect.width / evidence.width) * 100}%`, height: `${(n.rect.height / evidence.height) * 100}%` }}
            >
              <span className="absolute -top-0.5 -left-0.5 rounded-sm bg-danger px-1 text-[12px] leading-4 font-bold text-surface-200">{n.n}</span>
            </div>
          ))}
        </div>
        <ol className="flex flex-col gap-2">
          {current.nodes.map((n) => (
            <li key={n.lhId} className="flex items-start gap-3 rounded-sm border border-border p-2">
              <span className="rounded-sm bg-danger px-1.5 text-[13px] font-bold text-surface-200">{n.n}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="break-words text-ink">{n.label}</span>
                <code className="w-fit max-w-full rounded-sm bg-surface-300 px-1 font-mono text-[13px] break-all">{n.selector}</code>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
