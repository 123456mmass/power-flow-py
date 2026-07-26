"use client";

import { useRouter } from "next/navigation";

import { ANALYSIS_SHORT } from "@/lib/domain/catalog";
import type { RunSummary } from "@/lib/domain/types";
import { isTerminal } from "@/lib/domain/types";
import { Badge, StatusBadge } from "@/components/ui/feedback";
import { DataTable, type Column } from "@/components/ui/table";
import { formatDuration, formatExp, formatTimestamp } from "@/lib/utils/format";

export function runHref(run: RunSummary): string {
  return isTerminal(run.status) ? `/results/${run.id}` : `/runs/${run.id}`;
}

export function RunTable({
  runs,
  showToolbar = true,
  maxHeight,
  csvName = "runs",
  actionsColumn,
}: {
  runs: RunSummary[];
  showToolbar?: boolean;
  maxHeight?: string;
  csvName?: string;
  actionsColumn?: Column<RunSummary>;
}) {
  const router = useRouter();

  const columns: Column<RunSummary>[] = [
    {
      id: "id",
      header: "Run",
      accessor: (row) => row.id,
      render: (row) => (
        <span className="num text-[12px] text-fg-muted">{row.id}</span>
      ),
      width: "84px",
    },
    {
      id: "label",
      header: "Case",
      accessor: (row) => row.caseName,
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-fg">{row.caseName}</span>
          <span className="num truncate text-[11px] text-fg-subtle">{row.caseId}</span>
        </span>
      ),
    },
    {
      id: "analysis",
      header: "Type",
      accessor: (row) => row.analysis,
      render: (row) => <Badge tone="primary">{ANALYSIS_SHORT[row.analysis]}</Badge>,
      width: "72px",
    },
    {
      id: "solver",
      header: "Solver / model",
      accessor: (row) => `${row.solver} ${row.model ?? ""}`,
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12px] text-fg">{row.solver}</span>
          {row.model ? <span className="num truncate text-[11px] text-fg-subtle">{row.model}</span> : null}
        </span>
      ),
    },
    {
      id: "startedAt",
      header: "Started",
      accessor: (row) => Date.parse(row.startedAt),
      render: (row) => <span className="num text-[12px]">{formatTimestamp(row.startedAt)}</span>,
      align: "right",
      width: "152px",
    },
    {
      id: "duration",
      header: "Duration",
      accessor: (row) => row.durationMs ?? 0,
      render: (row) => <span className="num">{formatDuration(row.durationMs)}</span>,
      align: "right",
      width: "92px",
    },
    {
      id: "mismatch",
      header: "Max mismatch",
      unit: "pu",
      accessor: (row) => row.maxMismatch ?? 0,
      render: (row) => <span className="num">{row.maxMismatch === null ? "—" : formatExp(row.maxMismatch, 2)}</span>,
      align: "right",
      defaultHidden: true,
      width: "112px",
    },
    {
      id: "user",
      header: "User",
      accessor: (row) => row.user,
      defaultHidden: true,
    },
    {
      id: "status",
      header: "Status",
      accessor: (row) => row.status,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={row.status} />
          {row.warnings > 0 ? (
            <Badge tone="warn" title={`${row.warnings} warning(s)`}>
              {row.warnings}
            </Badge>
          ) : null}
        </span>
      ),
      width: "132px",
    },
    ...(actionsColumn ? [actionsColumn] : []),
  ];

  return (
    <DataTable
      columns={columns}
      rows={runs}
      getRowId={(row) => row.id}
      initialSort={{ id: "startedAt", direction: "desc" }}
      searchPlaceholder="Filter by case, solver, user…"
      csvName={csvName}
      showToolbar={showToolbar}
      maxHeight={maxHeight ?? "24rem"}
      caption="Recent analysis runs"
      onRowClick={(row) => router.push(runHref(row))}
      emptyTitle="No runs match the current filters"
      emptyDescription="Adjust the filters or dispatch a new analysis."
    />
  );
}
