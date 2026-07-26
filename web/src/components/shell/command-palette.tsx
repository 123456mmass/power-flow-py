"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ANALYSIS_LABELS, ALL_CASES, DEFAULT_CASE } from "@/lib/domain/catalog";
import type { AnalysisKind, RunSummary } from "@/lib/domain/types";

import { NAV_ITEMS } from "./nav-items";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/runs?pageSize=8", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { items: RunSummary[] };
        if (active) setRuns(payload.items);
      } catch {
        /* palette still works for navigation */
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded border border-line-strong bg-surface-1 shadow-[var(--shadow-panel)]"
      overlayClassName="fixed inset-0 z-40 bg-black/55"
    >
      <Command.Input
        placeholder="Jump to a page, run, or start an analysis…"
        className="w-full border-b border-line bg-surface-inset px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <Command.List className="max-h-[52vh] overflow-y-auto p-1.5">
        <Command.Empty className="px-2 py-6 text-center text-[12.5px] text-fg-subtle">No matches.</Command.Empty>

        <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-subtle">
          {NAV_ITEMS.map((item) => (
            <Command.Item
              key={item.href}
              value={`${item.label} ${item.description}`}
              onSelect={() => go(item.href)}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] text-fg data-[selected=true]:bg-surface-3"
            >
              <item.icon aria-hidden className="size-4 text-fg-subtle" />
              <span className="flex-1 truncate">{item.label}</span>
              <span className="truncate text-[11px] text-fg-subtle">{item.description}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Start analysis" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-subtle">
          {(Object.keys(ANALYSIS_LABELS) as AnalysisKind[]).map((analysis) => (
            <Command.Item
              key={analysis}
              value={`new ${analysis} ${ANALYSIS_LABELS[analysis]}`}
              onSelect={() => go(`/analysis/new?analysis=${analysis}&case=${DEFAULT_CASE[analysis]}`)}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] text-fg data-[selected=true]:bg-surface-3"
            >
              <span className="num w-10 shrink-0 text-[11px] uppercase text-primary">{analysis}</span>
              <span className="flex-1 truncate">New {ANALYSIS_LABELS[analysis]}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {runs.length > 0 ? (
          <Command.Group heading="Recent runs" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-subtle">
            {runs.map((run) => (
              <Command.Item
                key={run.id}
                value={`${run.id} ${run.label} ${run.caseId} ${run.analysis}`}
                onSelect={() => go(run.status === "converged" || run.status === "failed" || run.status === "cancelled" ? `/results/${run.id}` : `/runs/${run.id}`)}
                className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] text-fg data-[selected=true]:bg-surface-3"
              >
                <span className="num w-16 shrink-0 text-[11px] text-fg-subtle">{run.id}</span>
                <span className="flex-1 truncate">{run.label}</span>
                <span className="text-[11px] uppercase text-fg-subtle">{run.status}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group heading="Cases" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-fg-subtle">
          {ALL_CASES.map((item) => (
            <Command.Item
              key={item.id}
              value={`${item.id} ${item.name}`}
              onSelect={() => go(`/analysis/new?analysis=${item.analyses[0] ?? "pf"}&case=${item.id}`)}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] text-fg data-[selected=true]:bg-surface-3"
            >
              <span className="num w-16 shrink-0 text-[11px] text-fg-subtle">{item.id}</span>
              <span className="flex-1 truncate">{item.name}</span>
              <span className="num text-[11px] text-fg-subtle">{item.buses} bus</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
      <footer className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-fg-subtle">
        <span>↑↓ navigate · ⏎ open · esc close</span>
        <span className="num">Ctrl K</span>
      </footer>
    </Command.Dialog>
  );
}
