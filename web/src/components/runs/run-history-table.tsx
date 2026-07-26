"use client";

import { Copy, ExternalLink, GitCompareArrows, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RunTable, runHref } from "@/components/runs/run-table";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import {
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import type { RunSummary } from "@/lib/domain/types";
import type { Column } from "@/components/ui/table";

export function RunHistoryTable({ runs, canMutate }: { runs: RunSummary[]; canMutate: boolean }) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<RunSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());

  const remove = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${pendingDelete.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Delete failed (${response.status}).`);
        return;
      }
      setPendingDelete(null);
      router.refresh();
    } catch {
      setError("Cannot reach the solver service.");
    } finally {
      setDeleting(false);
    }
  };

  const actionsColumn: Column<RunSummary> = {
    id: "actions",
    header: "",
    accessor: () => "",
    sortable: false,
    width: "94px",
    render: (row) => (
      <span className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${row.id} for comparison`}
          checked={compareSet.has(row.id)}
          onChange={() =>
            setCompareSet((current) => {
              const next = new Set(current);
              if (next.has(row.id)) next.delete(row.id);
              else next.add(row.id);
              return next;
            })
          }
          className="size-3 accent-[var(--primary)]"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.id}`}>
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => router.push(runHref(row))}>
              <ExternalLink aria-hidden className="size-3.5" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/analysis/new?from=${row.id}`)}>
              <Copy aria-hidden className="size-3.5" />
              Duplicate configuration
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push(`/compare?runs=${row.id}`)}>
              <GitCompareArrows aria-hidden className="size-3.5" />
              Compare
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive disabled={!canMutate} onSelect={() => setPendingDelete(row)}>
              <Trash2 aria-hidden className="size-3.5" />
              Delete run
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    ),
  };

  return (
    <>
      {error ? <ErrorState title="Action failed" message={error} className="m-2" /> : null}
      {compareSet.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-primary-soft px-2.5 py-1.5">
          <span className="num text-[12px] text-fg">{compareSet.size} selected</span>
          <Button
            variant="primary"
            size="sm"
            disabled={compareSet.size < 2}
            onClick={() => router.push(`/compare?runs=${[...compareSet].join(",")}`)}
          >
            <GitCompareArrows aria-hidden className="size-3.5" />
            Compare selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCompareSet(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}
      <RunTable runs={runs} maxHeight="calc(100vh - 20rem)" csvName="run-history" actionsColumn={actionsColumn} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.id ?? ""}?`}
        description={`This permanently removes the run record, its streamed samples and its logs${
          pendingDelete ? ` for ${pendingDelete.caseName}` : ""
        }. Audit entries are retained.`}
        confirmLabel="Delete run"
        destructive
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </>
  );
}
