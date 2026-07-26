"use client";

import { useState } from "react";

import { EigenvaluePlot } from "@/components/charts/eigenvalue-plot";
import { Badge } from "@/components/ui/feedback";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import { DataTable, type Column } from "@/components/ui/table";
import type { EigenMode, SssaResult } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatNumber, formatPercent } from "@/lib/utils/format";

export function SssaResultView({ result, runId }: { result: SssaResult; runId: string }) {
  const [highlight, setHighlight] = useState<number | null>(result.criticalModeIndex);

  const columns: Column<EigenMode>[] = [
    { id: "index", header: "Mode", accessor: (row) => row.index, align: "right", width: "64px" },
    {
      id: "eigenvalue",
      header: "λ",
      accessor: (row) => row.real,
      render: (row) => (
        <span className="num">
          {formatNumber(row.real, 4)} {row.imag > 0 ? `± j${formatNumber(row.imag, 4)}` : ""}
        </span>
      ),
      align: "right",
      width: "180px",
    },
    {
      id: "frequency",
      header: "Frequency",
      unit: "Hz",
      accessor: (row) => row.frequencyHz,
      render: (row) => (row.frequencyHz > 0 ? formatNumber(row.frequencyHz, 4) : "—"),
      align: "right",
    },
    {
      id: "damping",
      header: "Damping",
      unit: "%",
      accessor: (row) => row.dampingRatio,
      render: (row) => (
        <span
          className={cn(
            row.dampingRatio < 0 && "text-danger",
            row.dampingRatio >= 0 && row.dampingRatio < 0.05 && "text-warn",
          )}
        >
          {formatNumber(row.dampingRatio * 100, 2)}
        </span>
      ),
      align: "right",
    },
    {
      id: "tau",
      header: "Time constant",
      unit: "s",
      accessor: (row) => row.timeConstantS ?? 0,
      render: (row) => (row.timeConstantS === null ? "—" : formatNumber(row.timeConstantS, 4)),
      align: "right",
    },
    {
      id: "classification",
      header: "Class",
      accessor: (row) => row.classification,
      render: (row) => (
        <Badge tone={row.classification === "unstable" ? "danger" : row.classification === "marginal" ? "warn" : "ok"}>
          {row.classification}
        </Badge>
      ),
      width: "104px",
    },
    { id: "state", header: "Dominant state", accessor: (row) => row.dominantState },
    {
      id: "participation",
      header: "Participation",
      accessor: (row) => row.participation,
      render: (row) => formatNumber(row.participation, 3),
      align: "right",
      defaultHidden: true,
    },
  ];

  const oscillatory = result.modes.filter((mode) => mode.imag > 0);

  return (
    <div className="space-y-2">
      <div className="grid gap-2 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Stability assessment"
            actions={<Badge tone={result.stable ? "ok" : "danger"}>{result.stable ? "stable" : "unstable"}</Badge>}
          />
          <div className="p-3">
            <KeyValue
              columns={1}
              items={[
                { label: "Model", value: result.model },
                { label: "Classification", value: result.classification, mono: false },
                { label: "States", value: result.stateCount },
                { label: "Oscillatory modes", value: oscillatory.length },
                { label: "Min damping ratio", value: formatPercent(result.minDampingRatio, 2) },
                { label: "Critical mode", value: `#${result.criticalModeIndex}` },
                { label: "COI reduction", value: result.coiReduction ? "applied" : "not applied", mono: false },
              ]}
            />
            {highlight !== null ? (
              <div className="mt-3 rounded border border-line bg-surface-2/50 p-2 text-[12px]">
                <p className="font-medium text-fg">Selected mode #{highlight}</p>
                {(() => {
                  const mode = result.modes.find((item) => item.index === highlight);
                  if (!mode) return <p className="text-fg-subtle">Not found.</p>;
                  return (
                    <p className="num mt-1 text-fg-muted">
                      λ = {formatNumber(mode.real, 5)}
                      {mode.imag > 0 ? ` ± j${formatNumber(mode.imag, 5)}` : ""} · f = {formatNumber(mode.frequencyHz, 4)} Hz
                      · ζ = {formatNumber(mode.dampingRatio * 100, 2)} % · state {mode.dominantState}
                    </p>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Eigenvalue map (complex plane)"
            subtitle="Right-half plane is shaded; dotted rays are constant-damping loci"
          />
          <div className="p-1">
            <EigenvaluePlot modes={result.modes} onSelectMode={setHighlight} height={392} />
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Mode table" subtitle={`${result.modes.length} eigenvalues`} />
        <DataTable
          columns={columns}
          rows={result.modes}
          getRowId={(row) => String(row.index)}
          initialSort={{ id: "damping", direction: "asc" }}
          csvName={`${runId}-modes`}
          searchPlaceholder="Filter modes by state or class…"
          maxHeight="30rem"
          caption="Eigenvalues with damping and frequency"
          onRowClick={(row) => setHighlight(row.index)}
        />
      </Panel>
    </div>
  );
}
