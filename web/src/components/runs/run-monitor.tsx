"use client";

import {
  Activity,
  BarChart3,
  Copy,
  Radio,
  RefreshCw,
  Square,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { PANEL_ORDER, PANEL_TITLES, PANEL_UNITS, markerColor, seriesColor } from "@/components/charts/palette";
import { SignalChart } from "@/components/charts/signal-chart";
import type { ChartHandle, ChartMarker, ChartSeriesSpec } from "@/components/charts/uplot-chart";
import { LogConsole } from "@/components/runs/log-console";
import { IbrSwitchAnimation } from "@/components/runs/ibr-switch-animation";
import { SignalTree } from "@/components/runs/signal-tree";
import { Button } from "@/components/ui/button";
import { Badge, ErrorState, ProgressBar, StatusBadge, statusTone } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/overlay";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import { ANALYSIS_LABELS } from "@/lib/domain/catalog";
import type { RunDetail, SeriesChunk, SignalPanel } from "@/lib/domain/types";
import { isTerminal } from "@/lib/domain/types";
import { useRunStream } from "@/lib/hooks/use-run-stream";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatNumber, formatPercent, formatTimestamp } from "@/lib/utils/format";

const DEFAULT_VISIBLE_PANELS: SignalPanel[] = ["voltage", "frequency", "agsi", "power"];

function defaultSelection(run: RunDetail): Set<string> {
  const byPanel = new Map<SignalPanel, string[]>();
  for (const signal of run.signals) {
    const bucket = byPanel.get(signal.panel) ?? [];
    bucket.push(signal.id);
    byPanel.set(signal.panel, bucket);
  }
  const selected: string[] = [];
  for (const panel of PANEL_ORDER) {
    const ids = byPanel.get(panel) ?? [];
    if (ids.length === 0) continue;
    const take = DEFAULT_VISIBLE_PANELS.includes(panel) ? 4 : 2;
    selected.push(...ids.slice(0, take));
  }
  return new Set(selected.length > 0 ? selected : run.signals.slice(0, 6).map((signal) => signal.id));
}

export function RunMonitor({ initial, canMutate }: { initial: RunDetail; canMutate: boolean }) {
  const chartRefs = useRef<Record<SignalPanel, { current: ChartHandle | null }>>({
    voltage: { current: null },
    angle: { current: null },
    frequency: { current: null },
    power: { current: null },
    agsi: { current: null },
    mode: { current: null },
    residual: { current: null },
  });

  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(initial));
  const [follow, setFollow] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Keep the server and first client render identical; wall time starts after
  // hydration so an active run does not trigger a text mismatch.
  const [now, setNow] = useState<number | null>(null);

  const pushChunk = (chunk: SeriesChunk, mode: "snapshot" | "live") => {
    for (const panel of PANEL_ORDER) {
      const handle = chartRefs.current[panel].current;
      if (!handle) continue;
      if (mode === "snapshot") handle.append(chunk.t, chunk.values);
      else handle.append(chunk.t, chunk.values);
    }
  };

  const { detail, progress, status, logs, events, connection, streamError, latestSample, reconnectCount } = useRunStream({
    runId: initial.id,
    initial,
    onChunk: pushChunk,
  });

  useEffect(() => {
    if (isTerminal(status)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const panelSeries = useMemo(() => {
    const map = new Map<SignalPanel, ChartSeriesSpec[]>();
    let colorIndex = 0;
    for (const signal of detail.signals) {
      if (!selected.has(signal.id)) continue;
      const bucket = map.get(signal.panel) ?? [];
      bucket.push({
        id: signal.id,
        label: signal.label,
        unit: signal.unit,
        color: seriesColor(colorIndex++),
        step: signal.panel === "mode",
      });
      map.set(signal.panel, bucket);
    }
    return map;
  }, [detail.signals, selected]);

  const markers = useMemo<ChartMarker[]>(
    () =>
      events.map((event) => ({
        t: event.t,
        label: event.kind === "mode_switch" ? event.label.split(":").pop()?.trim() ?? event.label : event.label,
        color: markerColor(event.severity),
      })),
    [events],
  );

  const timeDomain = detail.analysis === "ts" || detail.analysis === "ibr";
  const axisLabel = timeDomain ? "Simulated time [s]" : "Iteration";
  const elapsedMs = isTerminal(status)
    ? detail.durationMs ?? progress.elapsedMs
    : Math.max(progress.elapsedMs, now === null ? progress.elapsedMs : now - Date.parse(detail.startedAt));

  const cancel = async () => {
    setCancelling(true);
    try {
      await fetch(`/api/runs/${detail.id}/cancel`, { method: "POST" });
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  };

  const activePanels = PANEL_ORDER.filter((panel) => (panelSeries.get(panel)?.length ?? 0) > 0);

  return (
    <div className="space-y-2 p-3">
      {/* ------------------------------------------------------- state banner */}
      <Panel
        className={cn(
          "border-l-[3px]",
          status === "converged" && "border-l-ok",
          status === "failed" && "border-l-danger",
          status === "cancelled" && "border-l-warn",
          (status === "running" || status === "initializing") && "border-l-primary",
          status === "queued" && "border-l-line-strong",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status} />
              <h1 className="truncate text-[16px] font-semibold tracking-tight">{detail.label}</h1>
              <span className="num text-[12px] text-fg-subtle">{detail.id}</span>
              <Badge tone="primary">{ANALYSIS_LABELS[detail.analysis]}</Badge>
            </div>
            <p className="mt-1 text-[12.5px] text-fg-muted">
              {detail.caseName} <span className="num text-fg-subtle">({detail.caseId})</span> · {detail.solver}
              {detail.model ? <span className="num"> · {detail.model}</span> : null} · worker{" "}
              <span className="num">{detail.worker}</span> · started {formatTimestamp(detail.startedAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11.5px]",
                connection === "open" && "border-ok/40 bg-ok-soft text-ok",
                connection === "connecting" && "border-info/40 bg-info-soft text-info",
                connection === "reconnecting" && "border-warn/40 bg-warn-soft text-warn",
                connection === "closed" && "border-line bg-surface-2 text-fg-subtle",
              )}
            >
              {connection === "reconnecting" ? (
                <RefreshCw aria-hidden className="size-3 animate-spin" />
              ) : connection === "closed" ? (
                <WifiOff aria-hidden className="size-3" />
              ) : (
                <Radio aria-hidden className={cn("size-3", connection === "open" && "live-dot")} />
              )}
              {connection === "open"
                ? "stream live"
                : connection === "reconnecting"
                  ? `reconnecting (${reconnectCount})`
                  : connection === "connecting"
                    ? "connecting"
                    : "stream closed"}
            </span>
            {!isTerminal(status) ? (
              <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={!canMutate}>
                <Square aria-hidden className="size-3.5" />
                Cancel run
              </Button>
            ) : (
              <Link
                href={`/results/${detail.id}`}
                className="inline-flex h-8.5 items-center gap-1.5 rounded bg-primary px-3 text-[13px] font-medium text-primary-fg hover:bg-primary-hover"
              >
                <BarChart3 aria-hidden className="size-3.5" />
                Open results
              </Link>
            )}
            <Link
              href={`/analysis/new?from=${detail.id}`}
              className="inline-flex h-8.5 items-center gap-1.5 rounded border border-line bg-surface-2 px-3 text-[13px] text-fg hover:border-line-strong"
            >
              <Copy aria-hidden className="size-3.5" />
              Duplicate
            </Link>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-line px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="font-medium text-fg">{progress.stage}</span>
            <span className="num text-fg-muted">
              {timeDomain && progress.simTime !== null
                ? `t = ${formatNumber(progress.simTime, 4)} / ${formatNumber(progress.simEnd ?? 0, 3)} s`
                : `step ${progress.step} / ${progress.totalSteps ?? "?"}`}
              {" · "}
              {formatPercent(progress.fraction, 1)}
              {" · elapsed "}
              {formatDuration(elapsedMs)}
              {progress.etaMs !== null && !isTerminal(status) ? ` · eta ${formatDuration(progress.etaMs)}` : ""}
            </span>
          </div>
          <ProgressBar
            fraction={progress.fraction}
            tone={statusTone(status)}
            label={`Run progress ${Math.round(progress.fraction * 100)} %`}
            indeterminate={status === "queued" || status === "initializing"}
          />
        </div>

        {detail.reason && isTerminal(status) ? (
          <p
            className={cn(
              "border-t border-line px-3 py-1.5 text-[12px]",
              status === "failed" ? "text-danger" : "text-fg-muted",
            )}
          >
            {status === "failed" ? <TriangleAlert aria-hidden className="mr-1 inline size-3.5" /> : null}
            reason: <span className="num">{detail.reason}</span>
            {detail.errorCode ? (
              <>
                {" · code: "}
                <span className="num">{detail.errorCode}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </Panel>

      {streamError ? (
        <ErrorState
          title="Telemetry stream interrupted"
          message={streamError}
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden className="size-3.5" />
              Reconnect
            </Button>
          }
        />
      ) : null}

      {detail.analysis === "ibr" && detail.caseId.endsWith("_switch") ? (
        <IbrSwitchAnimation
          caseId={detail.caseId}
          signals={detail.signals}
          latest={latestSample}
          events={events}
          status={status}
        />
      ) : null}

      {/* ----------------------------------------------- charts + selectors */}
      <div className="grid gap-2 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2">
          <SignalTree signals={detail.signals} selected={selected} onChange={setSelected} height="16rem" />

          <Panel>
            <PanelHeader
              title="Event markers"
              actions={<Badge tone={events.length > 0 ? "warn" : "neutral"}>{events.length}</Badge>}
            />
            <div className="max-h-[13rem] overflow-auto">
              {events.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-fg-subtle">No events recorded yet.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {[...events]
                    .sort((a, b) => a.t - b.t)
                    .map((event) => (
                      <li key={event.id} className="px-2.5 py-1.5">
                        <div className="flex items-baseline gap-2">
                          <span
                            aria-hidden
                            className="mt-1 size-2 shrink-0 rounded-full"
                            style={{ background: markerColor(event.severity) }}
                          />
                          <span className="num shrink-0 text-[11.5px] text-fg-subtle">{formatNumber(event.t, 4)} s</span>
                          <span className="min-w-0 flex-1 text-[12px] text-fg">{event.label}</span>
                        </div>
                        <p className="ml-4 mt-0.5 text-[11px] text-fg-subtle">{event.detail}</p>
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Execution metadata" />
            <div className="p-2.5">
              <KeyValue
                columns={1}
                items={[
                  { label: "Solver", value: detail.environment.solverVersion, mono: false },
                  { label: "Python", value: detail.environment.python },
                  { label: "NumPy", value: detail.environment.numpy },
                  { label: "SciPy", value: detail.environment.scipy },
                  { label: "Seed", value: detail.environment.seed },
                  { label: "Signals", value: detail.signals.length },
                  { label: "Log records", value: logs.length },
                ]}
              />
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface-1 px-2.5 py-1.5">
            <Activity aria-hidden className="size-3.5 text-primary" />
            <span className="text-[12px] text-fg-muted">
              {activePanels.length} panel{activePanels.length === 1 ? "" : "s"} · {selected.size} signals ·{" "}
              {progress.step.toLocaleString()} samples streamed
            </span>
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-fg-muted">
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
                className="size-3 accent-[var(--primary)]"
              />
              Follow newest samples
            </label>
            <span className="text-[11px] text-fg-subtle">
              Drag to zoom · ctrl+wheel to scale · double-click to reset. Zoom is preserved while data streams.
            </span>
          </div>

          {activePanels.length === 0 ? (
            <Panel>
              <div className="px-3 py-10 text-center text-[12.5px] text-fg-subtle">
                Select at least one signal in the tree to plot telemetry.
              </div>
            </Panel>
          ) : (
            <div className="grid gap-2 2xl:grid-cols-2">
              {activePanels.map((panel) => (
                <SignalChart
                  key={panel}
                  title={PANEL_TITLES[panel]}
                  unit={PANEL_UNITS[panel]}
                  xLabel={axisLabel}
                  exportName={`${detail.id}-${panel}`}
                  series={panelSeries.get(panel) ?? []}
                  markers={markers}
                  follow={follow}
                  logScaleY={panel === "residual"}
                  height={panel === "mode" || panel === "residual" ? 150 : 200}
                  chartRef={chartRefs.current[panel]}
                  className={activePanels.length === 1 ? "2xl:col-span-2" : undefined}
                />
              ))}
            </div>
          )}

          <LogConsole logs={logs} runId={detail.id} height="16rem" />
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this run?"
        description="The worker stops at the current step. Partial samples and logs are retained, and the run is marked cancelled."
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        loading={cancelling}
        onConfirm={() => void cancel()}
      />

      <p className="sr-only" aria-live="polite">
        Run {detail.id} status {status}, {Math.round(progress.fraction * 100)} percent complete.
      </p>
    </div>
  );
}
