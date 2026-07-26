"use client";

import { useEffect, useRef } from "react";

import { SignalChart } from "@/components/charts/signal-chart";
import { seriesColor } from "@/components/charts/palette";
import type { ChartHandle } from "@/components/charts/uplot-chart";
import type { DashboardStats } from "@/lib/domain/types";

export function TrendCharts({ trend }: { trend: DashboardStats["trend"] }) {
  const voltageRef = useRef<ChartHandle | null>(null);
  const frequencyRef = useRef<ChartHandle | null>(null);

  useEffect(() => {
    voltageRef.current?.replace(trend.t, { voltage: trend.voltagePu });
    frequencyRef.current?.replace(trend.t, { frequency: trend.frequencyHz });
  }, [trend]);

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <SignalChart
        title="Reference bus voltage — last 24 h"
        unit="pu"
        xLabel="Minutes ago"
        exportName="trend-voltage"
        height={140}
        follow={false}
        chartRef={voltageRef}
        series={[{ id: "voltage", label: "V bus 1", unit: "pu", color: seriesColor(0) }]}
      />
      <SignalChart
        title="System frequency — last 24 h"
        unit="Hz"
        xLabel="Minutes ago"
        exportName="trend-frequency"
        height={140}
        follow={false}
        chartRef={frequencyRef}
        series={[{ id: "frequency", label: "f COI", unit: "Hz", color: seriesColor(3) }]}
      />
    </div>
  );
}
