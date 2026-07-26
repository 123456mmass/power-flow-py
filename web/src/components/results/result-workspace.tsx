"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ArrowLeft, Copy, Download, FileJson, GitCompareArrows, Printer, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PfResultView } from "@/components/results/pf-result";
import { SssaResultView } from "@/components/results/sssa-result";
import { TdsResultView } from "@/components/results/tds-result";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/feedback";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import { ANALYSIS_LABELS } from "@/lib/domain/catalog";
import { toCliCommand } from "@/lib/domain/cli";
import type { RunResultPayload } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { downloadBlob, formatDuration, formatExp, formatNumber, formatTimestamp, toCsv } from "@/lib/utils/format";

const TAB_TRIGGER =
  "rounded-t border-b-2 border-transparent px-3 py-1.5 text-[12.5px] text-fg-muted hover:text-fg " +
  "data-[state=active]:border-primary data-[state=active]:text-fg focus-visible:outline-2 focus-visible:outline-focus";

export function ResultWorkspace({ payload }: { payload: RunResultPayload }) {
  const { run, result, warnings, inputSnapshot } = payload;
  const [printMode, setPrintMode] = useState(false);

  const exportJson = () => {
    downloadBlob(`${run.id}-result.json`, "application/json", JSON.stringify(payload, null, 2));
  };

  const exportCsv = () => {
    if (result.kind === "pf") {
      const headers = ["bus", "name", "type", "v_pu", "theta_deg", "p_gen_mw", "q_gen_mvar", "p_load_mw", "q_load_mvar"];
      const rows = result.buses.map((bus) => [
        bus.busId,
        bus.name,
        bus.type,
        bus.vMagPu,
        bus.vAngleDeg,
        bus.pGenMw,
        bus.qGenMvar,
        bus.pLoadMw,
        bus.qLoadMvar,
      ]);
      downloadBlob(`${run.id}-buses.csv`, "text/csv;charset=utf-8", toCsv(headers, rows));
      return;
    }
    if (result.kind === "sssa") {
      const headers = ["mode", "real", "imag", "frequency_hz", "damping_ratio", "classification", "dominant_state"];
      const rows = result.modes.map((mode) => [
        mode.index,
        mode.real,
        mode.imag,
        mode.frequencyHz,
        mode.dampingRatio,
        mode.classification,
        mode.dominantState,
      ]);
      downloadBlob(`${run.id}-modes.csv`, "text/csv;charset=utf-8", toCsv(headers, rows));
      return;
    }
    const headers = ["time_s", ...result.series.map((series) => `${series.signalId} [${series.unit}]`)];
    const rows = result.time.map((t, index) => [t, ...result.series.map((series) => series.values[index] ?? null)]);
    downloadBlob(`${run.id}-timeseries.csv`, "text/csv;charset=utf-8", toCsv(headers, rows));
  };

  const overview = (
    <div className="space-y-2">
      <div className="grid gap-2 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Execution overview" />
          <div className="p-3">
            <KeyValue
              columns={2}
              items={[
                { label: "Run", value: run.id },
                { label: "Status", value: run.status, mono: false },
                { label: "Analysis", value: ANALYSIS_LABELS[run.analysis], mono: false },
                { label: "Case", value: `${run.caseName} (${run.caseId})`, mono: false },
                { label: "Solver", value: run.solver, mono: false },
                { label: "Model", value: run.model ?? "—" },
                { label: "Started", value: formatTimestamp(run.startedAt) },
                { label: "Finished", value: formatTimestamp(run.finishedAt) },
                { label: "Wall time", value: formatDuration(run.durationMs) },
                { label: "Worker", value: run.worker },
                { label: "User", value: run.user },
                { label: "Reason", value: run.reason ?? "—" },
                ...(run.errorCode ? [{ label: "Error code", value: run.errorCode }] : []),
                { label: "Finite status", value: run.finiteStatus ?? "—" },
                { label: "Seed", value: run.environment.seed },
                { label: "Stack", value: `py ${run.environment.python} · numpy ${run.environment.numpy} · scipy ${run.environment.scipy}` },
              ]}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Warnings"
            actions={<Badge tone={warnings.length > 0 ? "warn" : "ok"}>{warnings.length}</Badge>}
          />
          <div className="p-3">
            {warnings.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted">No warnings were raised during this study.</p>
            ) : (
              <ul className="space-y-1.5">
                {warnings.map((warning) => (
                  <li key={warning} className="flex gap-2 text-[12.5px] text-fg-muted">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Headline numbers" />
          <div className="p-3">
            <KeyValue
              columns={2}
              items={
                result.kind === "pf"
                  ? [
                      { label: "Converged", value: result.converged ? "yes" : "no", mono: false },
                      { label: "Iterations", value: result.iterations },
                      { label: "Max mismatch", value: `${formatExp(result.maxMismatch, 4)} pu` },
                      { label: "Losses", value: `${formatNumber(result.pLossTotalMw, 3)} MW` },
                    ]
                  : result.kind === "sssa"
                    ? [
                        { label: "Stable", value: result.stable ? "yes" : "no", mono: false },
                        { label: "Classification", value: result.classification, mono: false },
                        { label: "States", value: result.stateCount },
                        { label: "Min damping", value: `${formatNumber(result.minDampingRatio * 100, 2)} %` },
                      ]
                    : [
                        { label: "Steps", value: result.steps.toLocaleString() },
                        { label: "dt", value: `${formatNumber(result.dt * 1000, 4)} ms` },
                        { label: "Peak |Δδ|", value: `${formatNumber(result.maxAngleDeviationDeg, 3)} °` },
                        { label: "Peak |Δf|", value: `${formatNumber(result.maxFrequencyDeviationHz, 4)} Hz` },
                      ]
              }
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Input snapshot"
            icon={<FileJson className="size-3.5" />}
            actions={
              <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(inputSnapshot, null, 2))}>
                <Copy aria-hidden className="size-3.5" />
                Copy
              </Button>
            }
          />
          <pre className="max-h-[18rem] overflow-auto bg-surface-inset p-3 text-[11.5px] leading-[1.5]">
            <code className="num">{JSON.stringify(inputSnapshot, null, 2)}</code>
          </pre>
          <div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
            <Terminal aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            <code className="num min-w-0 flex-1 truncate text-[11px] text-fg-muted">{toCliCommand(inputSnapshot)}</code>
          </div>
        </Panel>
      </div>
    </div>
  );

  const detailView =
    result.kind === "pf" ? (
      <PfResultView result={result} runId={run.id} />
    ) : result.kind === "sssa" ? (
      <SssaResultView result={result} runId={run.id} />
    ) : (
      <TdsResultView result={result} runId={run.id} />
    );

  if (printMode) {
    return (
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 no-print">
          <Button variant="secondary" onClick={() => setPrintMode(false)}>
            <ArrowLeft aria-hidden className="size-3.5" />
            Back to workspace
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            <Printer aria-hidden className="size-3.5" />
            Print / save PDF
          </Button>
          <p className="text-[12px] text-fg-subtle">
            Report layout: header, overview, warnings, headline numbers, then the full result section.
          </p>
        </div>

        <header className="border-b border-line pb-2">
          <h1 className="text-[18px] font-semibold">
            {ANALYSIS_LABELS[run.analysis]} report — {run.caseName}
          </h1>
          <p className="num text-[12px] text-fg-muted">
            {run.id} · {run.solver} · {formatTimestamp(run.startedAt)} · wall {formatDuration(run.durationMs)} · status{" "}
            {run.status}
          </p>
        </header>
        {overview}
        <div className="print-break" />
        {detailView}
        <footer className="border-t border-line pt-2 text-[11px] text-fg-subtle">
          Generated by Grid Analysis Console · solver {run.environment.solverVersion} · seed {run.environment.seed}
        </footer>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={run.status} />
              <h1 className="truncate text-[16px] font-semibold tracking-tight">{run.label}</h1>
              <span className="num text-[12px] text-fg-subtle">{run.id}</span>
              <Badge tone="primary">{ANALYSIS_LABELS[run.analysis]}</Badge>
              {warnings.length > 0 ? <Badge tone="warn">{warnings.length} warnings</Badge> : null}
            </div>
            <p className="mt-1 text-[12.5px] text-fg-muted">
              {run.caseName} <span className="num text-fg-subtle">({run.caseId})</span> · {run.solver} · wall{" "}
              {formatDuration(run.durationMs)} · finished {formatTimestamp(run.finishedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 no-print">
            <Button variant="ghost" onClick={exportCsv}>
              <Download aria-hidden className="size-3.5" />
              CSV
            </Button>
            <Button variant="ghost" onClick={exportJson}>
              <FileJson aria-hidden className="size-3.5" />
              JSON
            </Button>
            <Button variant="ghost" onClick={() => setPrintMode(true)}>
              <Printer aria-hidden className="size-3.5" />
              Report
            </Button>
            <Link
              href={`/compare?runs=${run.id}`}
              className="inline-flex h-8.5 items-center gap-1.5 rounded border border-line bg-surface-2 px-3 text-[13px] text-fg hover:border-line-strong"
            >
              <GitCompareArrows aria-hidden className="size-3.5" />
              Compare
            </Link>
            <Link
              href={`/analysis/new?from=${run.id}`}
              className="inline-flex h-8.5 items-center gap-1.5 rounded border border-line bg-surface-2 px-3 text-[13px] text-fg hover:border-line-strong"
            >
              <Copy aria-hidden className="size-3.5" />
              Duplicate
            </Link>
          </div>
        </div>
      </Panel>

      <TabsPrimitive.Root defaultValue="results">
        <TabsPrimitive.List
          aria-label="Result sections"
          className="flex items-center gap-1 border-b border-line px-1 no-print"
        >
          <TabsPrimitive.Trigger value="overview" className={cn(TAB_TRIGGER)}>
            Overview
          </TabsPrimitive.Trigger>
          <TabsPrimitive.Trigger value="results" className={cn(TAB_TRIGGER)}>
            {result.kind === "pf" ? "Bus & branch results" : result.kind === "sssa" ? "Modes & eigenvalues" : "Trajectories & events"}
          </TabsPrimitive.Trigger>
        </TabsPrimitive.List>
        <TabsPrimitive.Content value="overview" className="pt-2 focus-visible:outline-none">
          {overview}
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="results" className="pt-2 focus-visible:outline-none">
          {detailView}
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}
