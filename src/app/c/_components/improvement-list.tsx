import Link from "next/link";
import { PROFILE_LABEL } from "@/lib/audit-format";
import { cx } from "@/lib/ui/cx";
import type { ImprovementCategory } from "@/server/domain/improvements";
import type { PortalImprovementBlock, PortalImprovementPage, PortalImprovements } from "@/server/services/portal";
import { ChevronRight } from "./portal-icons";

const CATEGORY_LABEL: Record<ImprovementCategory, string> = { performance: "Rendimiento", accessibility: "Accesibilidad", seo: "SEO", "best-practices": "Buenas prácticas" };
/** La pestaña del detalle de ingeniería que corresponde a cada rubro (`?vista=`). */
const VIEW_TAB: Record<ImprovementCategory, string> = { performance: "rendimiento", accessibility: "accesibilidad", seo: "seo", "best-practices": "buenas-practicas" };
/** Cuántas causas se enseñan por rubro antes de «ver las demás». */
const VISIBLE = 5;

const blockLabel = (b: PortalImprovementBlock) => (b.category ? CATEGORY_LABEL[b.category] : "Auditoría");
const detailHref = (base: string, b: PortalImprovementBlock) => (b.auditId ? `${base}/detalle/${b.auditId}${b.category ? `?vista=${VIEW_TAB[b.category]}` : ""}` : null);

function Item({ n, text, impact }: { n: number; text: string; impact: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-300 text-[13px] font-semibold text-ink-muted tabular-nums">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-[16px] leading-6 break-words text-ink">{text}</span>
      {impact ? <span className="shrink-0 pt-0.5 text-[14px] font-semibold text-danger tabular-nums">{impact}</span> : null}
    </li>
  );
}

function Block({ block, base }: { block: PortalImprovementBlock; base: string }) {
  const href = detailHref(base, block);
  const first = block.items.slice(0, VISIBLE);
  const rest = block.items.slice(VISIBLE);
  return (
    <section aria-label={`${blockLabel(block)} · ${PROFILE_LABEL[block.profile]}`} className="flex flex-col gap-1 rounded-lg bg-surface-100 px-3 py-2">
      <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px] leading-5 font-semibold text-ink-muted">
        <span>
          {blockLabel(block)} · {PROFILE_LABEL[block.profile]}
        </span>
        {block.kind === "threshold" && block.value !== null ? (
          <span className="font-normal">
            nota <b className="font-semibold text-danger">{block.value}</b>
            {block.threshold !== null ? ` · meta ${block.threshold}` : ""}
          </span>
        ) : null}
      </h3>
      {block.kind === "audit_failure" ? (
        <p className="py-2 text-[16px] leading-6 text-ink">No pudimos auditar esta página en {PROFILE_LABEL[block.profile].toLowerCase()}. Lo estamos revisando.</p>
      ) : block.items.length === 0 ? (
        <p className="py-2 text-[15px] leading-5 text-ink-muted">Está por debajo de la meta. {href ? "El detalle de ingeniería muestra las causas." : ""}</p>
      ) : (
        <>
          <ol className="divide-y divide-border">
            {first.map((it, i) => (
              <Item key={it.id} n={i + 1} text={it.text} impact={it.impact} />
            ))}
          </ol>
          {rest.length > 0 ? (
            <details className="group">
              <summary className="press flex min-h-11 items-center gap-1 text-[15px] font-semibold text-link">
                Ver las {rest.length} {rest.length === 1 ? "restante" : "restantes"}
                <ChevronRight className="chev" />
              </summary>
              <ol className="divide-y divide-border">
                {rest.map((it, i) => (
                  <Item key={it.id} n={VISIBLE + i + 1} text={it.text} impact={it.impact} />
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function PageRow({ page, base, open }: { page: PortalImprovementPage; base: string; open: boolean }) {
  const primary = page.blocks.find((b) => b.auditId) ?? null;
  const href = primary ? detailHref(base, primary) : null;
  return (
    <li className="min-w-0">
      <details open={open} className="hud min-w-0 rounded-lg">
        <summary className="press flex min-h-14 flex-col gap-2 rounded-lg px-3 py-2.5">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[17px] leading-6 font-semibold break-words text-ink [overflow-wrap:anywhere] line-clamp-2">{page.title}</span>
            <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[13px] leading-6 font-semibold text-white tabular-nums">
              {page.blocks.length}
              <span className="sr-only"> {page.blocks.length === 1 ? "mejora pendiente" : "mejoras pendientes"}</span>
            </span>
            <ChevronRight className="chev shrink-0 text-ink-muted" />
          </span>
          <span className="flex flex-wrap gap-1.5">
            {page.blocks.map((b, i) => (
              <span key={i} className={cx("rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium", "bg-danger-subtle text-on-danger-subtle")}>
                {blockLabel(b)} · {PROFILE_LABEL[b.profile].toLowerCase()}
              </span>
            ))}
          </span>
        </summary>
        <div className="flex min-w-0 flex-col gap-3 px-3 pb-4">
          {page.blocks.map((b, i) => (
            <Block key={i} block={b} base={base} />
          ))}
          {href ? (
            <Link href={href} className="press inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-[17px] font-semibold text-on-primary">
              Ver detalle de ingeniería
            </Link>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/** Las páginas con algo por mejorar: se abre la primera (la más urgente); cada una enumera sus causas por rubro. */
export function ImprovementList({ data, base }: { data: PortalImprovements; base: string }) {
  return (
    // `grid-cols-1`: ver route-tree.tsx (una columna `auto` crece con el título más largo).
    <ul className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
      {data.pages.map((p, i) => (
        <PageRow key={p.path} page={p} base={base} open={i === 0} />
      ))}
    </ul>
  );
}
