"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils/cn";
import { downloadBlob, toCsv } from "@/lib/utils/format";

import { Button } from "./button";
import { EmptyState } from "./feedback";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./overlay";

export interface Column<T> {
  id: string;
  header: string;
  unit?: string;
  accessor: (row: T) => string | number | null;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  defaultHidden?: boolean;
  width?: string;
  mono?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  initialSort?: { id: string; direction: "asc" | "desc" };
  searchPlaceholder?: string;
  csvName?: string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbarExtra?: React.ReactNode;
  maxHeight?: string;
  caption?: string;
  className?: string;
  showToolbar?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  initialSort,
  searchPlaceholder = "Filter rows…",
  csvName,
  onRowClick,
  emptyTitle = "No rows match the current filter",
  emptyDescription,
  toolbarExtra,
  maxHeight = "26rem",
  caption,
  className,
  showToolbar = true,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(initialSort ?? null);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((column) => column.defaultHidden).map((column) => column.id)),
  );

  const visibleColumns = columns.filter((column) => !hidden.has(column.id));

  const processed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let output = rows;
    if (needle) {
      output = output.filter((row) =>
        visibleColumns.some((column) => String(column.accessor(row) ?? "").toLowerCase().includes(needle)),
      );
    }
    if (sort) {
      const column = columns.find((item) => item.id === sort.id);
      if (column) {
        const factor = sort.direction === "asc" ? 1 : -1;
        output = [...output].sort((left, right) => {
          const a = column.accessor(left);
          const b = column.accessor(right);
          if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
          return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true }) * factor;
        });
      }
    }
    return output;
  }, [columns, query, rows, sort, visibleColumns]);

  const toggleSort = (columnId: string) => {
    setSort((current) => {
      if (!current || current.id !== columnId) return { id: columnId, direction: "asc" };
      if (current.direction === "asc") return { id: columnId, direction: "desc" };
      return null;
    });
  };

  const exportCsv = () => {
    const headers = visibleColumns.map((column) => (column.unit ? `${column.header} [${column.unit}]` : column.header));
    const body = processed.map((row) => visibleColumns.map((column) => column.accessor(row)));
    downloadBlob(`${csvName ?? "table"}.csv`, "text/csv;charset=utf-8", toCsv(headers, body));
  };

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/40 px-2 py-1.5">
          <div className="relative min-w-[180px] flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-7 w-full rounded border border-line bg-surface-inset pl-7 pr-2 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
            />
          </div>
          {toolbarExtra}
          <span className="num shrink-0 text-[11.5px] text-fg-subtle">
            {processed.length} / {rows.length}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Choose columns">
                <Columns3 aria-hidden className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={!hidden.has(column.id)}
                  onCheckedChange={(checked) =>
                    setHidden((current) => {
                      const next = new Set(current);
                      if (checked) next.delete(column.id);
                      else next.add(column.id);
                      return next;
                    })
                  }
                >
                  {column.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {csvName ? (
            <Button variant="ghost" size="sm" onClick={exportCsv}>
              <Download aria-hidden className="size-3.5" />
              CSV
            </Button>
          ) : null}
        </div>
      ) : null}

      {processed.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="min-w-0 overflow-auto" style={{ maxHeight }}>
          <table className="w-full border-collapse text-[12.5px]">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr>
                {visibleColumns.map((column) => {
                  const active = sort?.id === column.id;
                  const sortable = column.sortable !== false;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      style={column.width ? { width: column.width } : undefined}
                      aria-sort={active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none"}
                      className={cn(
                        "border-b border-line-strong px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-muted",
                        column.align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-2 focus-visible:outline-focus",
                            column.align === "right" && "flex-row-reverse",
                          )}
                        >
                          <span>{column.header}</span>
                          {column.unit ? <span className="font-normal normal-case text-fg-subtle">[{column.unit}]</span> : null}
                          {active ? (
                            sort?.direction === "asc" ? (
                              <ArrowUp aria-hidden className="size-3 text-primary" />
                            ) : (
                              <ArrowDown aria-hidden className="size-3 text-primary" />
                            )
                          ) : (
                            <ChevronsUpDown aria-hidden className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        <span>
                          {column.header}
                          {column.unit ? <span className="ml-1 font-normal normal-case text-fg-subtle">[{column.unit}]</span> : null}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {processed.map((row) => (
                <tr
                  key={getRowId(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-line/60 last:border-0",
                    onRowClick && "cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                  )}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        "px-2 py-1 text-fg",
                        column.align === "right" ? "text-right" : "text-left",
                        column.mono !== false && column.align === "right" && "num",
                      )}
                    >
                      {column.render ? column.render(row) : (column.accessor(row) ?? "—")}
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
