import type { Metadata } from "next";
import Link from "next/link";

import { RunFilters } from "@/components/runs/run-filters";
import { RunHistoryTable } from "@/components/runs/run-history-table";
import { EmptyState } from "@/components/ui/feedback";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { AnalysisKind, RunStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { getSessionUser } from "@/server/auth/session";
import { readRuns } from "@/server/data";

export const metadata: Metadata = { title: "Runs" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function parseList(value: string | undefined): string[] {
  return (value ?? "").split(",").filter(Boolean);
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    search?: string;
    status?: string;
    analysis?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();
  const page = Number.parseInt(params.page ?? "1", 10) || 1;

  const result = await readRuns({
    page,
    pageSize: PAGE_SIZE,
    ...(params.search ? { search: params.search } : {}),
    status: parseList(params.status) as RunStatus[],
    analysis: parseList(params.analysis) as AnalysisKind[],
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  });

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const query = (target: number) => {
    const next = new URLSearchParams();
    if (params.search) next.set("search", params.search);
    if (params.status) next.set("status", params.status);
    if (params.analysis) next.set("analysis", params.analysis);
    if (params.from) next.set("from", params.from);
    if (params.to) next.set("to", params.to);
    if (target > 1) next.set("page", String(target));
    return next.size > 0 ? `?${next.toString()}` : "";
  };

  return (
    <div className="space-y-2 p-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Run history</h1>
          <p className="text-[12.5px] text-fg-muted">
            Search, filter and manage dispatched studies. Terminal runs open the result workspace; live runs open the
            monitor.
          </p>
        </div>
        <Link
          href="/analysis/new"
          className="inline-flex h-8 items-center rounded border border-line bg-surface-2 px-2.5 text-[12.5px] hover:border-primary/60"
        >
          New analysis
        </Link>
      </header>

      <Panel>
        <PanelHeader title="Filters" dense />
        <RunFilters total={result.total} />
        {result.items.length === 0 ? (
          <EmptyState
            title="No runs match these filters"
            description="Broaden the date range or clear the status filter."
            action={
              <Link href="/runs" className="text-[12.5px] text-primary hover:underline">
                Reset filters
              </Link>
            }
          />
        ) : (
          <RunHistoryTable
            runs={result.items}
            canMutate={user?.role === "engineer" || user?.role === "admin"}
          />
        )}
        <footer className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5">
          <span className="num text-[11.5px] text-fg-subtle">
            page {result.page} / {pageCount} · showing {result.items.length} of {result.total}
          </span>
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <Link
              href={`/runs${query(Math.max(1, page - 1))}`}
              aria-disabled={page <= 1}
              className={cn(
                "rounded border border-line px-2 py-1 text-[12px]",
                page <= 1 ? "pointer-events-none opacity-40" : "hover:border-line-strong",
              )}
            >
              Previous
            </Link>
            <Link
              href={`/runs${query(Math.min(pageCount, page + 1))}`}
              aria-disabled={page >= pageCount}
              className={cn(
                "rounded border border-line px-2 py-1 text-[12px]",
                page >= pageCount ? "pointer-events-none opacity-40" : "hover:border-line-strong",
              )}
            >
              Next
            </Link>
          </nav>
        </footer>
      </Panel>
    </div>
  );
}
