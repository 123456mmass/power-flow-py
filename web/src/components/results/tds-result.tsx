"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PANEL_ORDER, PANEL_TITLES, PANEL_UNITS, markerColor, seriesColor } from "@/components/charts/palette";
import { SignalChart } from "@/components/charts/signal-chart";
import type { ChartHandle, ChartMarker, ChartSeriesSpec } from "@/components/charts/uplot-chart";
import { SignalTree } from "@/components/runs/signal-tree";
import { Badge } from "@/components/ui/feedback";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import { DataTable, type Column } from "@/components/ui/table";
import type {
  SignalDescriptor,
  SignalPanel,
  SimEvent,
  SwitchTransaction,
  SwitchingResult,
  TdsResult,
} from "@/lib/domain/types";
import { formatNumber } from "@/lib/utils/format";

type AnyTds = TdsResult | SwitchingResult;

function isSwitching(result: AnyTds): result is SwitchingResult {
  return result.kind === "switching";
}

export function TdsResultView({ result, runId }: { result: AnyTds; runId: string }) {
  const signals: SignalDescriptor[] = useMemo(
    () =>
      result.series.map((series) => ({
        id: series.signalId,
        label: series.label,
        group: series.label.includes("(") ? (series.label.split("(").pop()?.replace(")", "").trim() ?? series.panel) : series.panel,
        unit: series.unit,
        panel: series.panel,
      })),
    [result.series],
  );

  const [selected, setSelected] = useState<Set<string>>(() => {
    const preferred = ["voltage", "frequency", "agsi", "power"] as SignalPanel[];
    const ids: string[] = [];
    for (const panel of preferred) {
      ids.push(
        ...result.series
          .filter((series) => series.panel === panel)
          .slice(0, 4)
          .map((series) => series.signalId),
      );
    }
    return new Set(ids.length > 0 ? ids : result.series.slice(0, 5).map((series) => series.signalId));
  });

  const chartRefs = useRef<Record<SignalPanel, { current: ChartHandle | null }>>({
    voltage: { current: null },
    angle: { current: null },
    frequency: { current: null },
    power: { current: null },
    agsi: { current: null },
    mode: { current: null },
    residual: { current: null },
  });

  const valuesById = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const series of result.series) map[series.signalId] = series.values;
    return map;
  }, [result.series]);

  const panelSeries = useMemo(() => {
    const map = new Map<SignalPanel, ChartSeriesSpec[]>();
    let colorIndex = 0;
    for (const series of result.series) {
      if (!selected.has(series.signalId)) continue;
      const bucket = map.get(series.panel) ?? [];
      bucket.push({
        id: series.signalId,
        label: series.label,
        unit: series.unit,
        color: seriesColor(colorIndex++),
        step: series.panel === "mode",
      });
      map.set(series.panel, bucket);
    }
    return map;
  }, [result.series, selected]);

  const activePanels = PANEL_ORDER.filter((panel) => (panelSeries.get(panel)?.length ?? 0) > 0);

  useEffect(() => {
    for (const panel of PANEL_ORDER) {
      chartRefs.current[panel].current?.replace(result.time, valuesById);
    }
  }, [activePanels.length, result.time, valuesById]);

  const markers = useMemo<ChartMarker[]>(
    () =>
      result.events.map((event) => ({
        t: event.t,
        label: event.kind === "mode_switch" ? (event.label.split(":").pop()?.trim() ?? event.label) : event.label,
        color: markerColor(event.severity),
      })),
    [result.events],
  );

  const eventColumns: Column<SimEvent>[] = [
    { id: "t", header: "Time", unit: "s", accessor: (row) => row.t, render: (row) => formatNumber(row.t, 4), align: "right", width: "96px" },
    {
      id: "kind",
      header: "Kind",
      accessor: (row) => row.kind,
      render: (row) => (
        <Badge tone={row.severity === "fault" ? "danger" : row.severity === "warning" ? "warn" : "info"}>{row.kind}</Badge>
      ),
      width: "120px",
    },
    { id: "label", header: "Event", accessor: (row) => row.label },
    { id: "device", header: "Device", accessor: (row) => row.device ?? "—", width: "110px" },
    { id: "detail", header: "Detail", accessor: (row) => row.detail },
  ];

  const transactionColumns: Column<SwitchTransaction>[] = [
    { id: "t", header: "Time", unit: "s", accessor: (row) => row.t, render: (row) => formatNumber(row.t, 4), align: "right", width: "96px" },
    { id: "device", header: "Device", accessor: (row) => row.device },
    {
      id: "transition",
      header: "Transition",
      accessor: (row) => `${row.from}->${row.to}`,
      render: (row) => (
        <span className="num flex items-center gap-1">
          <Badge tone="neutral">{row.from}</Badge>
          <span aria-hidden>→</span>
          <Badge tone={row.to === "GFM" ? "warn" : "info"}>{row.to}</Badge>
        </span>
      ),
      width: "170px",
    },
    { id: "agsi", header: "AGSI", accessor: (row) => row.agsi, render: (row) => formatNumber(row.agsi, 4), align: "right" },
    { id: "vpcc", header: "V PCC", unit: "pu", accessor: (row) => row.vPccPu, render: (row) => formatNumber(row.vPccPu, 4), align: "right" },
    { id: "trigger", header: "Trigger", accessor: (row) => row.trigger },
    {
      id: "accepted",
      header: "Accepted",
      accessor: (row) => (row.accepted ? "yes" : "no"),
      render: (row) => <Badge tone={row.accepted ? "ok" : "danger"}>{row.accepted ? "yes" : "no"}</Badge>,
      width: "96px",
    },
    { id: "note", header: "Note", accessor: (row) => row.note, defaultHidden: true },
  ];

  return (
    <div className="space-y-2">
      <div className="grid gap-2 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2">
          <Panel>
            <PanelHeader title="Simulation summary" />
            <div className="p-3">
              <KeyValue
                columns={1}
                items={[
                  { label: "Model", value: result.model },
                  { label: "Integrator", value: result.integrator },
                  { label: "Time step", value: `${formatNumber(result.dt * 1000, 4)} ms` },
                  { label: "End time", value: `${formatNumber(result.tEnd, 4)} s` },
                  { label: "Steps", value: result.steps.toLocaleString() },
                  { label: "Signals", value: result.series.length },
                  { label: "Peak |Δδ|", value: `${formatNumber(result.maxAngleDeviationDeg, 3)} °` },
                  { label: "Peak |Δf|", value: `${formatNumber(result.maxFrequencyDeviationHz, 4)} Hz` },
                  ...(isSwitching(result)
                    ? [
                        { label: "Devices", value: result.devices.length },
                        { label: "Mode transitions", value: result.transactions.length },
                      ]
                    : []),
                ]}
              />
            </div>
          </Panel>
          <SignalTree signals={signals} selected={selected} onChange={setSelected} height="22rem" />
        </div>

        <div className="min-w-0 space-y-2">
          {activePanels.length === 0 ? (
            <Panel>
              <div className="px-3 py-10 text-center text-[12.5px] text-fg-subtle">
                Select signals to plot the recorded trajectories.
              </div>
            </Panel>
          ) : (
            <div className="grid gap-2 2xl:grid-cols-2">
              {activePanels.map((panel) => (
                <SignalChart
                  key={panel}
                  title={PANEL_TITLES[panel]}
                  unit={PANEL_UNITS[panel]}
                  xLabel="Simulated time [s]"
                  exportName={`${runId}-${panel}`}
                  series={panelSeries.get(panel) ?? []}
                  markers={markers}
                  follow={false}
                  logScaleY={panel === "residual"}
                  height={panel === "mode" || panel === "residual" ? 160 : 210}
                  chartRef={chartRefs.current[panel]}
                  className={activePanels.length === 1 ? "2xl:col-span-2" : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {isSwitching(result) && result.transactions.length > 0 ? (
        <Panel>
          <PanelHeader
            title="AGSI++ switch transactions"
            subtitle="Control-mode hand-overs with the grid-strength index at the decision point"
          />
          <DataTable
            columns={transactionColumns}
            rows={result.transactions}
            getRowId={(row) => row.id}
            initialSort={{ id: "t", direction: "asc" }}
            csvName={`${runId}-transactions`}
            maxHeight="20rem"
            caption="Switching transactions"
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Event log" subtitle={`${result.events.length} discrete events`} />
        <DataTable
          columns={eventColumns}
          rows={result.events}
          getRowId={(row) => row.id}
          initialSort={{ id: "t", direction: "asc" }}
          csvName={`${runId}-events`}
          maxHeight="18rem"
          caption="Discrete simulation events"
        />
      </Panel>
    </div>
  );
}
