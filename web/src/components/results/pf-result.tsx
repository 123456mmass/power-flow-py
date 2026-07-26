"use client";

import { useEffect, useRef } from "react";

import { seriesColor } from "@/components/charts/palette";
import { SignalChart } from "@/components/charts/signal-chart";
import type { ChartHandle } from "@/components/charts/uplot-chart";
import { Badge } from "@/components/ui/feedback";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import { DataTable, type Column } from "@/components/ui/table";
import type { BranchRow, BusRow, PfResult, QLimitEventRow } from "@/lib/domain/types";
import { formatExp, formatNumber } from "@/lib/utils/format";

export function PfResultView({ result, runId }: { result: PfResult; runId: string }) {
  const chartRef = useRef<ChartHandle | null>(null);

  useEffect(() => {
    chartRef.current?.replace(
      result.mismatchHistory.map((_, index) => index + 1),
      { mismatch: result.mismatchHistory },
    );
  }, [result.mismatchHistory]);

  const busColumns: Column<BusRow>[] = [
    { id: "bus", header: "Bus", accessor: (row) => row.busId, align: "right", width: "64px" },
    { id: "name", header: "Name", accessor: (row) => row.name },
    {
      id: "type",
      header: "Type",
      accessor: (row) => row.type,
      render: (row) => (
        <Badge tone={row.type === "REF" ? "primary" : row.type === "PV" ? "info" : "neutral"}>{row.type}</Badge>
      ),
      width: "72px",
    },
    {
      id: "vmag",
      header: "V",
      unit: "pu",
      accessor: (row) => row.vMagPu,
      render: (row) => (
        <span className={row.vMagPu < 0.95 || row.vMagPu > 1.05 ? "text-warn" : undefined}>{formatNumber(row.vMagPu, 4)}</span>
      ),
      align: "right",
    },
    { id: "vang", header: "θ", unit: "deg", accessor: (row) => row.vAngleDeg, render: (row) => formatNumber(row.vAngleDeg, 3), align: "right" },
    { id: "pgen", header: "P gen", unit: "MW", accessor: (row) => row.pGenMw, render: (row) => formatNumber(row.pGenMw, 2), align: "right" },
    { id: "qgen", header: "Q gen", unit: "Mvar", accessor: (row) => row.qGenMvar, render: (row) => formatNumber(row.qGenMvar, 2), align: "right" },
    { id: "pload", header: "P load", unit: "MW", accessor: (row) => row.pLoadMw, render: (row) => formatNumber(row.pLoadMw, 2), align: "right" },
    { id: "qload", header: "Q load", unit: "Mvar", accessor: (row) => row.qLoadMvar, render: (row) => formatNumber(row.qLoadMvar, 2), align: "right" },
    {
      id: "qlimit",
      header: "Q limit",
      accessor: (row) => row.qLimitHit,
      render: (row) => (row.qLimitHit === "none" ? <span className="text-fg-subtle">—</span> : <Badge tone="warn">{row.qLimitHit}</Badge>),
      width: "90px",
    },
  ];

  const branchColumns: Column<BranchRow>[] = [
    { id: "id", header: "#", accessor: (row) => row.branchId, align: "right", width: "52px" },
    { id: "from", header: "From", accessor: (row) => row.fromBus, align: "right", width: "64px" },
    { id: "to", header: "To", accessor: (row) => row.toBus, align: "right", width: "64px" },
    { id: "pfrom", header: "P from", unit: "MW", accessor: (row) => row.pFromMw, render: (row) => formatNumber(row.pFromMw, 3), align: "right" },
    { id: "qfrom", header: "Q from", unit: "Mvar", accessor: (row) => row.qFromMvar, render: (row) => formatNumber(row.qFromMvar, 3), align: "right" },
    { id: "pto", header: "P to", unit: "MW", accessor: (row) => row.pToMw, render: (row) => formatNumber(row.pToMw, 3), align: "right", defaultHidden: true },
    { id: "qto", header: "Q to", unit: "Mvar", accessor: (row) => row.qToMvar, render: (row) => formatNumber(row.qToMvar, 3), align: "right", defaultHidden: true },
    { id: "ploss", header: "P loss", unit: "MW", accessor: (row) => row.pLossMw, render: (row) => formatNumber(row.pLossMw, 4), align: "right" },
    { id: "qloss", header: "Q loss", unit: "Mvar", accessor: (row) => row.qLossMvar, render: (row) => formatNumber(row.qLossMvar, 4), align: "right" },
    {
      id: "loading",
      header: "Loading",
      unit: "%",
      accessor: (row) => row.loadingPct,
      render: (row) => (
        <span className={row.loadingPct > 100 ? "text-danger" : row.loadingPct > 90 ? "text-warn" : undefined}>
          {formatNumber(row.loadingPct, 1)}
        </span>
      ),
      align: "right",
    },
  ];

  const qLimitColumns: Column<QLimitEventRow>[] = [
    { id: "round", header: "Round", accessor: (row) => row.round, align: "right", width: "72px" },
    { id: "bus", header: "Bus", accessor: (row) => row.busId, align: "right", width: "64px" },
    { id: "from", header: "From", accessor: (row) => row.fromType, width: "72px" },
    { id: "to", header: "To", accessor: (row) => row.toType, width: "72px" },
    { id: "qbefore", header: "Q before", unit: "Mvar", accessor: (row) => row.qBeforeMvar, render: (row) => formatNumber(row.qBeforeMvar, 3), align: "right" },
    { id: "qfixed", header: "Q fixed", unit: "Mvar", accessor: (row) => row.qFixedMvar, render: (row) => formatNumber(row.qFixedMvar, 3), align: "right" },
    { id: "limit", header: "Limit", accessor: (row) => row.limitType },
  ];

  return (
    <div className="space-y-2">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Convergence" />
          <div className="p-3">
            <KeyValue
              columns={2}
              items={[
                { label: "Method", value: result.method, mono: false },
                { label: "Converged", value: result.converged ? "yes" : "no", mono: false },
                { label: "Reason", value: result.reason },
                { label: "Finite status", value: result.finiteStatus },
                { label: "Iterations", value: result.iterations },
                { label: "Max mismatch", value: `${formatExp(result.maxMismatch, 4)} pu` },
                { label: "P loss total", value: `${formatNumber(result.pLossTotalMw, 3)} MW` },
                { label: "Q loss total", value: `${formatNumber(result.qLossTotalMvar, 3)} Mvar` },
                { label: "P gen / load", value: `${formatNumber(result.pTotalGenMw, 2)} / ${formatNumber(result.pTotalLoadMw, 2)} MW` },
                { label: "Q gen / load", value: `${formatNumber(result.qTotalGenMvar, 2)} / ${formatNumber(result.qTotalLoadMvar, 2)} Mvar` },
              ]}
            />
          </div>
        </Panel>

        <SignalChart
          title="Mismatch history"
          unit="pu"
          xLabel="Iteration"
          exportName={`${runId}-mismatch`}
          height={188}
          follow={false}
          logScaleY
          chartRef={chartRef}
          series={[{ id: "mismatch", label: "Max mismatch", unit: "pu", color: seriesColor(1) }]}
        />
      </div>

      <Panel>
        <PanelHeader title="Bus results" subtitle={`${result.buses.length} buses`} />
        <DataTable
          columns={busColumns}
          rows={result.buses}
          getRowId={(row) => String(row.busId)}
          initialSort={{ id: "bus", direction: "asc" }}
          csvName={`${runId}-buses`}
          searchPlaceholder="Filter buses…"
          maxHeight="28rem"
          caption="Bus voltage, angle, generation and load"
        />
      </Panel>

      <Panel>
        <PanelHeader title="Branch flows and losses" subtitle={`${result.branches.length} branches`} />
        <DataTable
          columns={branchColumns}
          rows={result.branches}
          getRowId={(row) => String(row.branchId)}
          initialSort={{ id: "loading", direction: "desc" }}
          csvName={`${runId}-branches`}
          searchPlaceholder="Filter branches…"
          maxHeight="28rem"
          caption="Branch active and reactive flows with losses"
        />
      </Panel>

      {result.qLimitEvents.length > 0 ? (
        <Panel>
          <PanelHeader title="Reactive-limit switching" subtitle="PV → PQ transitions enforced during the solve" />
          <DataTable
            columns={qLimitColumns}
            rows={result.qLimitEvents}
            getRowId={(row) => `${row.round}-${row.busId}`}
            csvName={`${runId}-qlimits`}
            maxHeight="16rem"
            showToolbar={false}
            caption="Reactive limit events"
          />
        </Panel>
      ) : null}
    </div>
  );
}
