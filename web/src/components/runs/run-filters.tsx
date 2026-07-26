"use client";

import { RotateCcw, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ANALYSIS_SHORT } from "@/lib/domain/catalog";
import { ANALYSIS_KINDS, RUN_STATUSES, type AnalysisKind, type RunStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export function RunFilters({ total }: { total: number }) {
  const router = useRouter();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("search") ?? "");
  const [statuses, setStatuses] = useState<Set<RunStatus>>(
    () => new Set((params.get("status") ?? "").split(",").filter(Boolean) as RunStatus[]),
  );
  const [analyses, setAnalyses] = useState<Set<AnalysisKind>>(
    () => new Set((params.get("analysis") ?? "").split(",").filter(Boolean) as AnalysisKind[]),
  );
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  useEffect(() => {
    setSearch(params.get("search") ?? "");
  }, [params]);

  const apply = (overrides?: {
    search?: string;
    statuses?: Set<RunStatus>;
    analyses?: Set<AnalysisKind>;
    from?: string;
    to?: string;
  }) => {
    const next = new URLSearchParams();
    const value = overrides?.search ?? search;
    const statusSet = overrides?.statuses ?? statuses;
    const analysisSet = overrides?.analyses ?? analyses;
    const fromValue = overrides?.from ?? from;
    const toValue = overrides?.to ?? to;
    if (value.trim()) next.set("search", value.trim());
    if (statusSet.size > 0) next.set("status", [...statusSet].join(","));
    if (analysisSet.size > 0) next.set("analysis", [...analysisSet].join(","));
    if (fromValue) next.set("from", fromValue);
    if (toValue) next.set("to", toValue);
    router.push(`/runs${next.size > 0 ? `?${next.toString()}` : ""}`);
  };

  const reset = () => {
    setSearch("");
    setStatuses(new Set());
    setAnalyses(new Set());
    setFrom("");
    setTo("");
    router.push("/runs");
  };

  const toggleStatus = (status: RunStatus) => {
    const next = new Set(statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    setStatuses(next);
    apply({ statuses: next });
  };

  const toggleAnalysis = (analysis: AnalysisKind) => {
    const next = new Set(analyses);
    if (next.has(analysis)) next.delete(analysis);
    else next.add(analysis);
    setAnalyses(next);
    apply({ analyses: next });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      className="flex flex-wrap items-end gap-2 border-b border-line bg-surface-2/40 px-2.5 py-2"
      aria-label="Run filters"
    >
      <div className="relative min-w-[200px] flex-1">
        <label htmlFor="run-search" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
          Search
        </label>
        <Search aria-hidden className="pointer-events-none absolute left-2 top-[26px] size-3.5 text-fg-subtle" />
        <input
          id="run-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Run id, case, solver, user…"
          className="h-8 w-full rounded border border-line bg-surface-inset pl-7 pr-2 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
        />
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-0.5 text-[11px] uppercase tracking-[0.05em] text-fg-subtle">Status</legend>
        <div className="flex flex-wrap gap-1">
          {RUN_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={statuses.has(status)}
              onClick={() => toggleStatus(status)}
              className={cn(
                "rounded border px-2 py-1 text-[11.5px] focus-visible:outline-2 focus-visible:outline-focus",
                statuses.has(status)
                  ? "border-primary bg-primary-soft text-fg"
                  : "border-line bg-surface-1 text-fg-muted hover:border-line-strong",
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-0.5 text-[11px] uppercase tracking-[0.05em] text-fg-subtle">Analysis</legend>
        <div className="flex flex-wrap gap-1">
          {ANALYSIS_KINDS.map((analysis) => (
            <button
              key={analysis}
              type="button"
              aria-pressed={analyses.has(analysis)}
              onClick={() => toggleAnalysis(analysis)}
              className={cn(
                "num rounded border px-2 py-1 text-[11.5px] uppercase focus-visible:outline-2 focus-visible:outline-focus",
                analyses.has(analysis)
                  ? "border-primary bg-primary-soft text-fg"
                  : "border-line bg-surface-1 text-fg-muted hover:border-line-strong",
              )}
            >
              {ANALYSIS_SHORT[analysis]}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="from" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
          From
        </label>
        <input
          id="from"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="num h-8 rounded border border-line bg-surface-inset px-2 text-[12.5px] text-fg focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
        />
      </div>
      <div>
        <label htmlFor="to" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
          To
        </label>
        <input
          id="to"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="num h-8 rounded border border-line bg-surface-inset px-2 text-[12.5px] text-fg focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
        />
      </div>

      <Button type="submit" variant="primary">
        Apply
      </Button>
      <Button type="button" variant="ghost" onClick={reset}>
        <RotateCcw aria-hidden className="size-3.5" />
        Reset
      </Button>
      <span className="num ml-auto text-[11.5px] text-fg-subtle">{total} matching runs</span>
    </form>
  );
}
