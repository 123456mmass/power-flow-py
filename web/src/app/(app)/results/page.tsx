import type { Metadata } from "next";

import { RunTable } from "@/components/runs/run-table";
import { EmptyState } from "@/components/ui/feedback";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { readRuns } from "@/server/data";

export const metadata: Metadata = { title: "Results" };
export const dynamic = "force-dynamic";

export default async function ResultsIndexPage() {
  const page = await readRuns({ pageSize: 100, status: ["converged", "failed", "cancelled"] });

  return (
    <div className="space-y-2 p-3">
      <header>
        <h1 className="text-[17px] font-semibold tracking-tight">Completed studies</h1>
        <p className="text-[12.5px] text-fg-muted">
          {page.total} finished runs with final results, tables and scientific plots.
        </p>
      </header>
      <Panel>
        <PanelHeader title="Result index" subtitle="Select a run to open its result workspace" />
        {page.items.length === 0 ? (
          <EmptyState title="No completed runs yet" description="Dispatch an analysis to populate this index." />
        ) : (
          <RunTable runs={page.items} maxHeight="calc(100vh - 15rem)" csvName="completed-runs" />
        )}
      </Panel>
    </div>
  );
}
