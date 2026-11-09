import type { ReactNode } from "react";

export type Column<Row> = {
  header: string;
  /** Cifras alineadas a la derecha. */
  numeric?: boolean;
  /** Ruta o texto largo que puede partirse en cualquier punto. */
  mono?: boolean;
  /** Se oculta en pantallas estrechas (menos de 640 px) para que la tabla quepa sin desplazarse. */
  hideOnMobile?: boolean;
  cell: (row: Row) => ReactNode;
};

/**
 * Tabla de un ranking. En pantallas estrechas se desplaza en horizontal dentro de su recuadro (la página no se
 * desborda). Sin filas, dice qué hacer en lugar de quedar vacía.
 */
export function DataTable<Row>({
  title,
  description,
  columns,
  rows,
  rowKey,
  empty,
  minWidth = "",
}: {
  title: string;
  description?: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty: string;
  minWidth?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-[19px] leading-6 font-semibold text-ink">{title}</h4>
        {description ? <p className="text-[15px] leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-sm border border-border bg-surface-100 px-3 py-4 text-[15px] leading-5 text-ink-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className={`w-full ${minWidth} border-collapse text-left text-[15px]`}>
            <caption className="sr-only">{title}</caption>
            <thead className="bg-surface-300 text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">
              <tr>
                {columns.map((c) => (
                  <th key={c.header} scope="col" className={`px-3 py-2 ${c.numeric ? "text-right" : ""} ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={rowKey(row)} className="align-top">
                  {columns.map((c) => (
                    <td key={c.header} className={`px-3 py-2 ${c.numeric ? "text-right whitespace-nowrap tabular-nums" : ""} ${c.mono ? "font-mono break-all" : ""} ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
