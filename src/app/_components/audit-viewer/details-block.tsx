import Link from "next/link";
import { middleTruncate } from "@/server/domain/inline-markdown";
import type { Cell, DetailsView, Row, TreeNode } from "@/server/domain/lhr-view";
import { InlineText } from "./inline-text";

export type DetailsContext = {
  /** Ids de elemento (lhId) que se pueden ver sobre la captura, y a dónde llevar. */
  evidenceHref?: (lhId: string) => string | null;
};

function CellView({ cell, ctx }: { cell: Cell | null; ctx: DetailsContext }) {
  if (!cell) return <span className="text-ink-muted">—</span>;
  switch (cell.k) {
    case "text":
      return <span className="break-words">{cell.v}</span>;
    case "code":
      return <code className="font-mono text-[14px] break-all" title={cell.v}>{middleTruncate(cell.v, 90)}</code>;
    case "url":
      return (
        <span className="font-mono text-[14px] break-all" title={cell.url}>
          {middleTruncate(cell.label, 70)}
        </span>
      );
    case "link":
      return /^https?:\/\//.test(cell.url) ? (
        <a href={cell.url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline break-all">{cell.text}</a>
      ) : (
        <span>{cell.text}</span>
      );
    case "num":
      return <span className="tabular-nums">{cell.v}</span>;
    case "thumb":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={cell.src} alt="" width={48} height={48} className="size-12 rounded-sm border border-border object-cover" />;
    case "list":
      return (
        <span className="flex flex-col gap-1">
          {cell.cells.map((c, i) => (
            <CellView key={i} cell={c} ctx={ctx} />
          ))}
        </span>
      );
    case "node": {
      const href = cell.lhId ? ctx.evidenceHref?.(cell.lhId) : null;
      return (
        <span className="flex min-w-0 flex-col gap-1">
          {cell.label && cell.label !== cell.selector ? <span className="break-words text-ink">{cell.label}</span> : null}
          {cell.selector ? <code className="w-fit max-w-full rounded-sm bg-surface-300 px-1 font-mono text-[13px] break-all">{cell.selector}</code> : null}
          {cell.snippet ? <code className="max-w-full font-mono text-[13px] break-all text-ink-muted">{middleTruncate(cell.snippet, 200)}</code> : null}
          {href ? (
            <Link href={href} className="w-fit text-[14px] font-semibold text-link hover:underline">
              Ver en la captura
            </Link>
          ) : null}
        </span>
      );
    }
  }
}

function Rows({ rows, keys, ctx, depth = 0 }: { rows: Row[]; keys: string[]; ctx: DetailsContext; depth?: number }) {
  return (
    <>
      {rows.map((r, i) => (
        <RowView key={`${depth}-${i}`} row={r} keys={keys} ctx={ctx} depth={depth} />
      ))}
    </>
  );
}

function RowView({ row, keys, ctx, depth }: { row: Row; keys: string[]; ctx: DetailsContext; depth: number }) {
  return (
    <>
      <tr className={depth > 0 ? "bg-surface-100" : ""}>
        {keys.map((k, ci) => (
          <td key={k} className={`border-t border-border px-3 py-2 align-top ${typeof row.cells[k] === "object" && row.cells[k]?.k === "num" ? "text-right" : ""} ${ci === 0 && depth > 0 ? "pl-8" : ""}`}>
            <CellView cell={row.cells[k] ?? null} ctx={ctx} />
          </td>
        ))}
      </tr>
      {row.sub.length > 0 ? <Rows rows={row.sub} keys={keys} ctx={ctx} depth={depth + 1} /> : null}
    </>
  );
}

function Tree({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return (
    <ul className={depth === 0 ? "flex flex-col gap-1" : "ml-4 flex flex-col gap-1 border-l border-border pl-3"}>
      {nodes.map((n, i) => (
        <li key={i} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-mono text-[14px] break-all" title={n.label}>{middleTruncate(n.label, 80)}</span>
            <span className="text-[14px] whitespace-nowrap text-ink-muted tabular-nums">{[n.time, n.size].filter(Boolean).join(" · ")}{n.longest ? " · cadena más larga" : ""}</span>
          </span>
          {n.children.length > 0 ? <Tree nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** El detalle de una auditoría: tablas, listas, árboles de red, listas de control y elementos. */
export function DetailsBlock({ details, ctx = {} }: { details: DetailsView | null; ctx?: DetailsContext }) {
  if (!details) return null;
  switch (details.t) {
    case "table": {
      const keys = details.headings.map((h) => h.key);
      return (
        <div className="flex flex-col gap-1">
          <div className="max-w-full overflow-x-auto rounded-sm border border-border">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="bg-surface-300">
                  {details.headings.map((h) => (
                    <th key={h.key} scope="col" className={`px-3 py-2 text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase ${h.right ? "text-right" : ""}`}>
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Rows rows={details.rows} keys={keys} ctx={ctx} />
              </tbody>
            </table>
          </div>
          {details.hidden > 0 ? <p className="text-[14px] text-ink-muted">y {details.hidden} {details.hidden === 1 ? "fila más" : "filas más"} (están en el informe completo).</p> : null}
        </div>
      );
    }
    case "list":
      return (
        <div className="flex flex-col gap-3">
          {details.items.map((d, i) => (
            <DetailsBlock key={i} details={d} ctx={ctx} />
          ))}
        </div>
      );
    case "section":
      return (
        <div className="flex flex-col gap-2">
          {details.title ? <h4 className="text-[16px] font-semibold text-ink">{details.title}</h4> : null}
          {details.description ? <p className="text-[15px] leading-5 text-ink-muted"><InlineText text={details.description} /></p> : null}
          <DetailsBlock details={details.value} ctx={ctx} />
        </div>
      );
    case "checklist":
      return (
        <ul className="flex flex-col gap-1">
          {details.items.map((i, k) => (
            <li key={k} className="flex items-start gap-2 text-[15px]">
              <span aria-hidden className={i.ok ? "text-ok" : "text-danger"}>{i.ok ? "✓" : "✗"}</span>
              <span>
                <span className="sr-only">{i.ok ? "Cumple: " : "No cumple: "}</span>
                {i.label}
              </span>
            </li>
          ))}
        </ul>
      );
    case "tree":
      return <Tree nodes={details.nodes} />;
    case "node":
      return <CellView cell={details.cell} ctx={ctx} />;
    case "text":
      return <p className="text-[15px]">{details.v}</p>;
  }
}
