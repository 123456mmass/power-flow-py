"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/feedback";
import { DataTable, type Column } from "@/components/ui/table";
import type { AuditEntry } from "@/lib/domain/types";
import { formatRelative, formatTimestamp } from "@/lib/utils/format";

const TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "info" | "primary"> = {
  login: "info",
  logout: "neutral",
  "run.submit": "primary",
  "run.cancel": "warn",
  "run.delete": "danger",
  "run.duplicate": "info",
  "preset.save": "ok",
  export: "neutral",
};

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const columns: Column<AuditEntry>[] = [
    {
      id: "at",
      header: "Timestamp",
      accessor: (row) => Date.parse(row.at),
      render: (row) => (
        <span className="flex flex-col">
          <span className="num text-[12px]">{formatTimestamp(row.at)}</span>
          <span className="text-[11px] text-fg-subtle">{formatRelative(row.at)}</span>
        </span>
      ),
      align: "right",
      width: "168px",
    },
    { id: "user", header: "User", accessor: (row) => row.user, width: "180px" },
    {
      id: "action",
      header: "Action",
      accessor: (row) => row.action,
      render: (row) => <Badge tone={TONE[row.action] ?? "neutral"}>{row.action}</Badge>,
      width: "132px",
    },
    {
      id: "runId",
      header: "Run",
      accessor: (row) => row.runId ?? "",
      render: (row) =>
        row.runId ? (
          <Link href={`/results/${row.runId}`} className="num text-primary hover:underline">
            {row.runId}
          </Link>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
      width: "96px",
    },
    { id: "detail", header: "Detail", accessor: (row) => row.detail },
    { id: "ip", header: "Source IP", accessor: (row) => row.ip, defaultHidden: true, width: "120px" },
  ];

  return (
    <DataTable
      columns={columns}
      rows={entries}
      getRowId={(row) => row.id}
      initialSort={{ id: "at", direction: "desc" }}
      csvName="audit-log"
      searchPlaceholder="Filter entries…"
      maxHeight="calc(100vh - 22rem)"
      caption="Audit trail entries"
      emptyTitle="No audit entries match"
    />
  );
}
