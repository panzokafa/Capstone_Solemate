// Komponen DataTable Solemate Design System.
// Menampilkan tabel semantik di tablet/desktop dan kartu responsif di ponsel bila renderMobileCard diberikan.
import * as React from "react";
import { Skeleton } from "./skeleton";

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  renderMobileCard?: (row: T) => React.ReactNode;
  loading?: boolean;
  loadingRows?: number;
  emptyState?: React.ReactNode;
  caption?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  renderMobileCard,
  loading = false,
  loadingRows = 5,
  emptyState,
  caption,
  className = "",
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={`rounded-3xl border border-border-card bg-surface-card p-5 flex flex-col gap-3 ${className}`}
      >
        <span className="sr-only">Memuat data...</span>
        {Array.from({ length: loadingRows }).map((_, idx) => (
          <Skeleton key={idx} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  const tabelKelas = renderMobileCard ? "hidden md:block" : "block";

  return (
    <div className={className}>
      <div
        className={`${tabelKelas} overflow-x-auto rounded-3xl border border-border-card bg-surface-card shadow-xs`}
      >
        <table className="w-full text-left font-jakarta text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-border-card bg-surface-subtle font-outfit text-xs font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3.5 ${col.headerClassName ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border-warm last:border-0 hover:bg-surface-hover/50 transition-colors"
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3.5 align-middle ${col.className ?? ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {renderMobileCard && (
        <ul className="flex flex-col gap-3 md:hidden">
          {data.map((row) => (
            <li key={rowKey(row)}>{renderMobileCard(row)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
