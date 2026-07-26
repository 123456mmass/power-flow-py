import type { Metadata } from "next";
import Link from "next/link";

import { AuditTable } from "@/components/logs/audit-table";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/utils/cn";
import { readAudit } from "@/server/data";

export const metadata: Metadata = { title: "Audit logs" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const ACTIONS = [
  "login",
  "logout",
  "run.submit",
  "run.cancel",
  "run.delete",
  "run.duplicate",
  "preset.save",
  "export",
];

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; action?: string; runId?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10) || 1;
  const result = await readAudit({
    page,
    pageSize: PAGE_SIZE,
    ...(params.search ? { search: params.search } : {}),
    ...(params.action ? { action: params.action } : {}),
    ...(params.runId ? { runId: params.runId } : {}),
  });
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const query = (target: number) => {
    const next = new URLSearchParams();
    if (params.search) next.set("search", params.search);
    if (params.action) next.set("action", params.action);
    if (params.runId) next.set("runId", params.runId);
    if (target > 1) next.set("page", String(target));
    return next.size > 0 ? `?${next.toString()}` : "";
  };

  return (
    <div className="space-y-2 p-3">
      <header>
        <h1 className="text-[17px] font-semibold tracking-tight">Audit log</h1>
        <p className="text-[12.5px] text-fg-muted">
          Who did what, when, and against which run. {result.total} entries recorded.
        </p>
      </header>

      <Panel>
        <PanelHeader title="Audit trail" dense />
        {/* No-JS friendly GET form; the server component reads these search params. */}
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-line bg-surface-2/40 px-2.5 py-2">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="audit-search" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
              Search
            </label>
            <input
              id="audit-search"
              name="search"
              type="search"
              defaultValue={params.search ?? ""}
              placeholder="User, detail, run id…"
              className="h-8 w-full rounded border border-line bg-surface-inset px-2 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
            />
          </div>
          <div>
            <label htmlFor="audit-action" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
              Action
            </label>
            <select
              id="audit-action"
              name="action"
              defaultValue={params.action ?? ""}
              className="h-8 rounded border border-line bg-surface-inset px-2 text-[12.5px] text-fg focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
            >
              <option value="">All actions</option>
              {ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-run" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
              Run id
            </label>
            <input
              id="audit-run"
              name="runId"
              defaultValue={params.runId ?? ""}
              placeholder="run-0001"
              className="num h-8 w-[110px] rounded border border-line bg-surface-inset px-2 text-[12.5px] text-fg focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
            />
          </div>
          <button
            type="submit"
            className="h-8 rounded bg-primary px-3 text-[12.5px] font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-focus"
          >
            Apply
          </button>
          <Link href="/logs" className="h-8 rounded border border-line px-3 pt-1.5 text-[12.5px] hover:border-line-strong">
            Reset
          </Link>
        </form>

        <AuditTable entries={result.items} />

        <footer className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5">
          <span className="num text-[11.5px] text-fg-subtle">
            page {result.page} / {pageCount} · {result.total} entries
          </span>
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <Link
              href={`/logs${query(Math.max(1, page - 1))}`}
              aria-disabled={page <= 1}
              className={cn(
                "rounded border border-line px-2 py-1 text-[12px]",
                page <= 1 ? "pointer-events-none opacity-40" : "hover:border-line-strong",
              )}
            >
              Previous
            </Link>
            <Link
              href={`/logs${query(Math.min(pageCount, page + 1))}`}
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
