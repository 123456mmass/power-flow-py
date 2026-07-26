"use client";

import { Crosshair, Download, Image as ImageIcon, Maximize2, Table2 } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils/cn";

import { UplotChart, type ChartHandle, type ChartMarker, type ChartSeriesSpec } from "./uplot-chart";

export interface SignalChartProps {
  title: string;
  unit?: string;
  series: ChartSeriesSpec[];
  height?: number;
  markers?: ChartMarker[];
  follow?: boolean;
  windowSize?: number | null;
  logScaleY?: boolean;
  xLabel?: string;
  exportName?: string;
  chartRef?: RefObject<ChartHandle | null>;
  className?: string;
  headerExtra?: React.ReactNode;
  emptyHint?: string;
  isEmpty?: boolean;
}

/**
 * Panel frame around a streaming chart: zoom state, export actions and a live
 * hint that zoom is preserved while samples arrive.
 */
export function SignalChart({
  title,
  unit,
  series,
  height = 210,
  markers = [],
  follow = true,
  windowSize = null,
  logScaleY = false,
  xLabel = "Simulated time [s]",
  exportName,
  chartRef,
  className,
  headerExtra,
  emptyHint,
  isEmpty,
}: SignalChartProps) {
  const internalRef = useRef<ChartHandle | null>(null);
  const handleRef = chartRef ?? internalRef;
  const [zoomed, setZoomed] = useState(false);
  const name = exportName ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <Panel className={cn("min-w-0", className)}>
      <header className="flex items-center gap-2 border-b border-line bg-surface-2/50 px-2.5 py-1">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {title}
          {unit ? <span className="ml-1.5 font-normal normal-case text-fg-subtle">[{unit}]</span> : null}
        </h3>
        {headerExtra}
        {zoomed ? (
          <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary-soft px-1.5 py-[1px] text-[10.5px] uppercase tracking-[0.05em] text-primary">
            <Crosshair aria-hidden className="size-3" />
            zoom held
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip content="Reset zoom (double-click the plot)">
            <Button variant="ghost" size="icon" aria-label="Reset zoom" onClick={() => handleRef.current?.resetZoom()}>
              <Maximize2 aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Export PNG">
            <Button variant="ghost" size="icon" aria-label="Export PNG" onClick={() => handleRef.current?.exportPng(name)}>
              <ImageIcon aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Export SVG">
            <Button variant="ghost" size="icon" aria-label="Export SVG" onClick={() => handleRef.current?.exportSvg(name)}>
              <Download aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Export CSV">
            <Button variant="ghost" size="icon" aria-label="Export CSV" onClick={() => handleRef.current?.exportCsv(name)}>
              <Table2 aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </header>
      <div className="min-w-0 px-1 pb-1 pt-1">
        {isEmpty ? (
          <div
            className="flex items-center justify-center text-[12px] text-fg-subtle"
            style={{ height }}
          >
            {emptyHint ?? "No samples for the selected signals yet."}
          </div>
        ) : (
          <UplotChart
            ref={handleRef}
            series={series}
            height={height}
            markers={markers}
            follow={follow}
            windowSize={windowSize}
            logScaleY={logScaleY}
            xLabel={xLabel}
            yLabel={unit}
            onZoomChange={setZoomed}
          />
        )}
      </div>
    </Panel>
  );
}
