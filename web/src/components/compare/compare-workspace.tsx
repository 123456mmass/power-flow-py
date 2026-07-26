"use client";

import { GitCompareArrows, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { EigenvaluePlot } from "@/components/charts/eigenvalue-plot";
import { PANEL_TITLES, PANEL_UNITS, seriesColor } from "@/components/charts/palette";
import { SignalChart } from "@/components/charts/signal-chart";
import type { ChartHandle, ChartSeriesSpec } from "@/components/charts/uplot-chart";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/inputs";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ANALYSIS_SHORT } from "@/lib/domain/catalog";
import type { RunResultPayload, RunSummary, SignalPanel } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatExp, formatNumber } from "@/lib/utils/format";

/**
 * Declared comparison tolerances.
 *
 * Values are UI review thresholds for spotting drift between runs; they are not
 * solver acceptance gates.
 */
const TOLERANCES: { metric: string; tolerance: string }[] = [
  { metric: "Bus voltage magnitude", tolerance: "1e-4 pu" },
  { metric: "Bus voltage angle", tolerance: "1e-3 deg" },
  { metric: "Max power mismatch", tolerance: "solver tolerance" },
  { metric: "Damping ratio", tolerance: "1e-3 (0.1 %)" },
  { metric: "Peak rotor-angle deviation", tolerance: "1e-2 deg" },
  { metric: "Peak frequency deviation", tolerance: "1e-4 Hz" },
];

interface MetricRow {
  label: string;
  unit: string;
  values: (number | string | null)[];
  tolerance?: string;
  delta?: string;
}

export function CompareWorkspace({
  payloads,
  candidates,
}: {
  payloads: RunResultPayload[];
  candidates: RunSummary[];
}) {
  const router = useRouter();
  const [addId, setAddId] = useState("");
  const ids = payloads.map((payload) => payload.run.id);

  const setRuns = (next: string[]) => {
    router.push(next.length > 0 ? `/compare?runs=${next.join(",")}` : "/compare");
  };

  const kinds = new Set(payloads.map((payload) => payload.result.kind));
  const sameKind = kinds.size === 1 ? [...kinds][0] : null;

  const metrics = useMemo<MetricRow[]>(() => {
    const rows: MetricRow[] = [
      {
        label: "Wall time",
        unit: "",
        values: payloads.map((payload) => formatDuration(payload.run.durationMs)),
      },
      {
        label: "Status",
        unit: "",
        values: payloads.map((payload) => payload.run.status),
      },
      {
        label: "Warnings",
        unit: "",
        values: payloads.map((payload) => payload.warnings.length),
      },
    ];

    if (sameKind === "pf") {
      const results = payloads.map((payload) => (payload.result.kind === "pf" ? payload.result : null));
      const iterations = results.map((result) => result?.iterations ?? null);
      const mismatch = results.map((result) => (result ? formatExp(result.maxMismatch, 3) : null));
      const losses = results.map((result) => (result ? formatNumber(result.pLossTotalMw, 3) : null));
      const vMin = results.map((result) =>
        result ? formatNumber(Math.min(...result.buses.map((bus) => bus.vMagPu)), 4) : null,
      );
      const first = results[0];
      let maxDeltaV: string | undefined;
      if (first) {
        let worst = 0;
        for (const result of results.slice(1)) {
          if (!result) continue;
          for (const bus of result.buses) {
            const reference = first.buses.find((item) => item.busId === bus.busId);
            if (!reference) continue;
            worst = Math.max(worst, Math.abs(reference.vMagPu - bus.vMagPu));
          }
        }
        maxDeltaV = formatExp(worst, 3);
      }
      rows.push(
        { label: "Iterations", unit: "", values: iterations },
        { label: "Max mismatch", unit: "pu", values: mismatch, tolerance: "solver tolerance" },
        { label: "Total real losses", unit: "MW", values: losses },
        { label: "Minimum bus voltage", unit: "pu", values: vMin, tolerance: "1e-4 pu" },
        ...(maxDeltaV ? [{ label: "max |ΔV| vs first run", unit: "pu", values: payloads.map(() => ""), delta: maxDeltaV, tolerance: "1e-4 pu" }] : []),
      );
    }

    if (sameKind === "sssa") {
      const results = payloads.map((payload) => (payload.result.kind === "sssa" ? payload.result : null));
      rows.push(
        { label: "Stable", unit: "", values: results.map((result) => (result ? (result.stable ? "yes" : "no") : null)) },
        {
          label: "Minimum damping",
          unit: "%",
          values: results.map((result) => (result ? formatNumber(result.minDampingRatio * 100, 3) : null)),
          tolerance: "0.1 %",
        },
        { label: "States", unit: "", values: results.map((result) => result?.stateCount ?? null) },
        { label: "Critical mode", unit: "", values: results.map((result) => (result ? `#${result.criticalModeIndex}` : null)) },
      );
    }

    if (sameKind === "tds" || sameKind === "switching") {
      const results = payloads.map((payload) =>
        payload.result.kind === "tds" || payload.result.kind === "switching" ? payload.result : null,
      );
      rows.push(
        { label: "Steps", unit: "", values: results.map((result) => result?.steps ?? null) },
        { label: "dt", unit: "ms", values: results.map((result) => (result ? formatNumber(result.dt * 1000, 4) : null)) },
        { label: "End time", unit: "s", values: results.map((result) => (result ? formatNumber(result.tEnd, 4) : null)) },
        {
          label: "Peak |Δδ|",
          unit: "deg",
          values: results.map((result) => (result ? formatNumber(result.maxAngleDeviationDeg, 3) : null)),
          tolerance: "1e-2 deg",
        },
        {
          label: "Peak |Δf|",
          unit: "Hz",
          values: results.map((result) => (result ? formatNumber(result.maxFrequencyDeviationHz, 5) : null)),
          tolerance: "1e-4 Hz",
        },
        { label: "Events", unit: "", values: results.map((result) => result?.events.length ?? null) },
      );
    }

    return rows;
  }, [payloads, sameKind]);

  /* --------------------------------------- aligned time-series overlay ---- */

  const timeSeriesPayloads = payloads.filter(
    (payload) => payload.result.kind === "tds" || payload.result.kind === "switching",
  );

  const availablePanels = useMemo(() => {
    const panels = new Set<SignalPanel>();
    for (const payload of timeSeriesPayloads) {
      if (payload.result.kind !== "tds" && payload.result.kind !== "switching") continue;
      for (const series of payload.result.series) panels.add(series.panel);
    }
    return [...panels];
  }, [timeSeriesPayloads]);

  const [panel, setPanel] = useState<SignalPanel>(availablePanels[0] ?? "voltage");
  const chartRef = useRef<ChartHandle | null>(null);

  const overlay = useMemo(() => {
    const specs: ChartSeriesSpec[] = [];
    const values: Record<string, number[]> = {};
    let time: number[] = [];
    let colorIndex = 0;
    for (const payload of timeSeriesPayloads) {
      if (payload.result.kind !== "tds" && payload.result.kind !== "switching") continue;
      const match = payload.result.series.find((series) => series.panel === panel);
      if (!match) continue;
      if (payload.result.time.length > time.length) time = payload.result.time;
      const id = `${payload.run.id}:${match.signalId}`;
      specs.push({
        id,
        label: `${payload.run.id} ${match.label}`,
        unit: match.unit,
        color: seriesColor(colorIndex++),
        dashed: colorIndex > 1,
        step: panel === "mode",
      });
      values[id] = match.values;
    }
    return { specs, values, time };
  }, [panel, timeSeriesPayloads]);

  useEffect(() => {
    if (overlay.specs.length === 0) return;
    chartRef.current?.replace(overlay.time, overlay.values);
  }, [overlay]);

  const sssaPayloads = payloads.filter((payload) => payload.result.kind === "sssa");

  return (
    <div className="space-y-2 p-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Compare runs</h1>
          <p className="text-[12.5px] text-fg-muted">
            Overlay two or more studies on aligned axes with the review tolerances shown next to each metric.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-[280px]">
            <label htmlFor="add-run" className="mb-0.5 block text-[11px] uppercase tracking-[0.05em] text-fg-subtle">
              Add a run
            </label>
            <Select
              id="add-run"
              value={addId}
              onValueChange={(value) => {
                setAddId(value);
                if (value) setRuns([...ids, value]);
              }}
              options={[
                { value: "", label: "Select a completed run…" },
                ...candidates
                  .filter((run) => !ids.includes(run.id))
                  .map((run) => ({
                    value: run.id,
                    label: `${run.id} · ${ANALYSIS_SHORT[run.analysis]} · ${run.caseName}`,
                  })),
              ]}
            />
          </div>
        </div>
      </header>

      {payloads.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<GitCompareArrows className="size-6" />}
            title="Select runs to compare"
            description="Pick completed runs from the selector above, or use the checkboxes in the run history."
          />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {payloads.map((payload) => (
              <span
                key={payload.run.id}
                className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-[12px]"
              >
                <Badge tone="primary">{ANALYSIS_SHORT[payload.run.analysis]}</Badge>
                <span className="num">{payload.run.id}</span>
                <span className="text-fg-muted">{payload.run.caseName}</span>
                <button
                  type="button"
                  aria-label={`Remove ${payload.run.id} from comparison`}
                  onClick={() => setRuns(ids.filter((id) => id !== payload.run.id))}
                  className="text-fg-subtle hover:text-danger focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            ))}
          </div>

          {sameKind === null ? (
            <p className="rounded border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-fg-muted">
              The selected runs use different analysis families. Scalar metadata is still comparable, but trajectory and
              mode overlays require the same analysis type.
            </p>
          ) : null}

          <Panel>
            <PanelHeader title="Metric comparison" subtitle="Review tolerances are declared per metric" />
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <caption className="sr-only">Comparison of run metrics</caption>
                <thead className="bg-surface-2">
                  <tr>
                    <th scope="col" className="border-b border-line-strong px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.05em] text-fg-muted">
                      Metric
                    </th>
                    {payloads.map((payload) => (
                      <th
                        key={payload.run.id}
                        scope="col"
                        className="num border-b border-line-strong px-2 py-1.5 text-right text-[11px] uppercase tracking-[0.05em] text-fg-muted"
                      >
                        {payload.run.id}
                      </th>
                    ))}
                    <th scope="col" className="border-b border-line-strong px-2 py-1.5 text-right text-[11px] uppercase tracking-[0.05em] text-fg-muted">
                      Tolerance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((row) => (
                    <tr key={row.label} className="border-b border-line/60">
                      <th scope="row" className="px-2 py-1 text-left font-normal text-fg-muted">
                        {row.label}
                        {row.unit ? <span className="ml-1 text-fg-subtle">[{row.unit}]</span> : null}
                      </th>
                      {row.values.map((value, index) => (
                        <td key={index} className="num px-2 py-1 text-right text-fg">
                          {row.delta && index === 0 ? row.delta : (value ?? "—")}
                        </td>
                      ))}
                      <td className="num px-2 py-1 text-right text-fg-subtle">{row.tolerance ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {overlay.specs.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="panel" className="text-[12px] text-fg-muted">
                  Overlay panel
                </label>
                <div className="w-[260px]">
                  <Select
                    id="panel"
                    value={panel}
                    onValueChange={(value) => setPanel(value as SignalPanel)}
                    options={availablePanels.map((item) => ({ value: item, label: PANEL_TITLES[item] }))}
                  />
                </div>
                <span className="text-[11.5px] text-fg-subtle">
                  Time axes are aligned on simulated seconds; the longest run defines the window.
                </span>
              </div>
              <SignalChart
                title={`${PANEL_TITLES[panel]} overlay`}
                unit={PANEL_UNITS[panel]}
                xLabel="Simulated time [s]"
                exportName={`compare-${panel}`}
                height={300}
                follow={false}
                series={overlay.specs}
                chartRef={chartRef}
              />
            </div>
          ) : null}

          {sssaPayloads.length > 0 ? (
            <div className={cn("grid gap-2", sssaPayloads.length > 1 && "lg:grid-cols-2")}>
              {sssaPayloads.map((payload) =>
                payload.result.kind === "sssa" ? (
                  <Panel key={payload.run.id}>
                    <PanelHeader title={`Eigenvalues ${payload.run.id}`} subtitle={payload.run.caseName} />
                    <div className="p-1">
                      <EigenvaluePlot modes={payload.result.modes} height={320} />
                    </div>
                  </Panel>
                ) : null,
              )}
            </div>
          ) : null}

          <Panel>
            <PanelHeader title="Declared review tolerances" />
            <ul className="divide-y divide-line">
              {TOLERANCES.map((item) => (
                <li key={item.metric} className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
                  <span className="text-fg-muted">{item.metric}</span>
                  <span className="num text-fg">{item.tolerance}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setRuns([])}>
              Clear comparison
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
