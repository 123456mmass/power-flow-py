"use client";

import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { downloadBlob, toCsv } from "@/lib/utils/format";

export interface ChartSeriesSpec {
  id: string;
  label: string;
  unit?: string;
  color: string;
  dashed?: boolean;
  /** Step interpolation, used for discrete control-mode signals. */
  step?: boolean;
}

export interface ChartMarker {
  t: number;
  label: string;
  color: string;
}

export interface ChartHandle {
  /** Appends a streamed batch without rebuilding the chart. */
  append: (t: number[], values: Record<string, number[]>) => void;
  /** Replaces the whole buffer (snapshot / reconnect resync). */
  replace: (t: number[], values: Record<string, number[]>) => void;
  resetZoom: () => void;
  exportPng: (filename: string) => void;
  exportSvg: (filename: string) => void;
  exportCsv: (filename: string) => void;
  isZoomed: () => boolean;
}

export interface UplotChartProps {
  series: ChartSeriesSpec[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  markers?: ChartMarker[];
  /** Follow the newest sample while not zoomed. */
  follow?: boolean;
  /** Sliding window in x units; null keeps the full history. */
  windowSize?: number | null;
  legend?: boolean;
  logScaleY?: boolean;
  className?: string;
  onZoomChange?: (zoomed: boolean) => void;
}

interface Store {
  t: number[];
  values: Record<string, number[]>;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Vertical event markers (fault, clearing, trips, mode switches). */
function markerPlugin(getMarkers: () => ChartMarker[]): uPlot.Plugin {
  const LANES = 3;
  const MAX_LABEL = 22;
  return {
    hooks: {
      draw: (u: uPlot) => {
        const markers = getMarkers();
        if (markers.length === 0) return;
        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.lineWidth = 1;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "top";

        // Labels are laid out in a few lanes so dense event sequences stay
        // readable instead of overprinting each other.
        const laneEnd = new Array<number>(LANES).fill(Number.NEGATIVE_INFINITY);
        const sorted = [...markers].sort((a, b) => a.t - b.t);

        for (const marker of sorted) {
          const x = u.valToPos(marker.t, "x", true);
          if (!Number.isFinite(x) || x < left || x > left + width) continue;

          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = marker.color;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + height);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = marker.color;
          ctx.fillRect(x - 1.5, top, 3, 4);

          const text = marker.label.length > MAX_LABEL ? `${marker.label.slice(0, MAX_LABEL - 1)}…` : marker.label;
          const textWidth = ctx.measureText(text).width;
          const flip = x + 4 + textWidth > left + width;
          const anchor = flip ? x - 4 - textWidth : x + 4;
          const lane = laneEnd.findIndex((end) => anchor > end + 4);
          if (lane === -1) continue;
          laneEnd[lane] = anchor + textWidth;
          ctx.fillText(text, anchor, top + 2 + lane * 12);
        }
        ctx.restore();
      },
    },
  };
}

/** Wheel zoom around the cursor plus shift-drag panning. */
function wheelZoomPlugin(): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.addEventListener(
          "wheel",
          (event: WheelEvent) => {
            if (!event.ctrlKey && !event.altKey && Math.abs(event.deltaY) < 1) return;
            event.preventDefault();
            const rect = over.getBoundingClientRect();
            const cursorX = event.clientX - rect.left;
            const xScale = u.scales.x;
            if (!xScale) return;
            const min = xScale.min ?? 0;
            const max = xScale.max ?? 1;
            const span = max - min;
            const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
            const atCursor = u.posToVal(cursorX, "x");
            const left = atCursor - (atCursor - min) * factor;
            const right = atCursor + (max - atCursor) * factor;
            if (right - left < span * 0.001) return;
            u.setScale("x", { min: left, max: right });
          },
          { passive: false },
        );
      },
    },
  };
}

export const UplotChart = forwardRef<ChartHandle, UplotChartProps>(function UplotChart(
  {
    series,
    height = 220,
    xLabel,
    yLabel,
    markers = [],
    follow = true,
    windowSize = null,
    legend = true,
    logScaleY = false,
    className,
    onZoomChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const storeRef = useRef<Store>({ t: [], values: {} });
  const markersRef = useRef<ChartMarker[]>(markers);
  const zoomedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const followRef = useRef(follow);

  markersRef.current = markers;
  followRef.current = follow;

  const seriesKey = useMemo(() => series.map((item) => `${item.id}:${item.color}`).join("|"), [series]);
  const [themeVersion, setThemeVersion] = useState(0);

  // Axis, grid and cursor colours come from CSS tokens read at creation time,
  // so the chart is rebuilt when the theme attribute flips.
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((version) => version + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const buildData = (): uPlot.AlignedData => {
    const store = storeRef.current;
    const columns = series.map((spec) => {
      const column = store.values[spec.id];
      if (!column) return new Array<number | null>(store.t.length).fill(null);
      return column.length === store.t.length ? column : [...column, ...new Array(store.t.length - column.length).fill(null)];
    });
    return [store.t, ...columns] as uPlot.AlignedData;
  };

  const scheduleFlush = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const chart = chartRef.current;
      if (!chart) return;
      const store = storeRef.current;
      // resetScales=false keeps the user's zoom while data grows.
      chart.setData(buildData(), false);
      if (!zoomedRef.current && followRef.current && store.t.length > 1) {
        const last = store.t[store.t.length - 1]!;
        const first = windowSize ? Math.max(store.t[0]!, last - windowSize) : store.t[0]!;
        chart.setScale("x", { min: first, max: last });
      }
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const axisColor = cssVar("--fg-subtle", "#6c7e91");
    const gridColor = cssVar("--grid-line", "rgba(148,163,184,0.14)");
    const textColor = cssVar("--fg-muted", "#94a4b6");

    const options: uPlot.Options = {
      width: container.clientWidth || 600,
      height,
      padding: [10, 12, 0, 0],
      cursor: {
        drag: { x: true, y: false },
        focus: { prox: 24 },
        points: { size: 5 },
      },
      legend: { show: legend, live: true, markers: { width: 3 } },
      scales: {
        x: { time: false },
        y: logScaleY
          ? { distr: 3, log: 10 }
          : {
              distr: 1,
              // Scientific traces are often near-constant; uPlot's default
              // "nice" range would zoom out to zero and hide the detail.
              range: (_u: uPlot, dataMin: number | null, dataMax: number | null): [number, number] => {
                if (dataMin === null || dataMax === null || !Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
                  return [0, 1];
                }
                if (dataMin === dataMax) {
                  const pad = Math.abs(dataMin) * 0.05 || 0.5;
                  return [dataMin - pad, dataMax + pad];
                }
                const pad = (dataMax - dataMin) * 0.08;
                return [dataMin - pad, dataMax + pad];
              },
            },
      },
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          font: "11px ui-sans-serif, system-ui, sans-serif",
          label: xLabel,
          labelFont: "11px ui-sans-serif, system-ui, sans-serif",
          labelSize: xLabel ? 22 : 0,
        },
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          font: "11px ui-sans-serif, system-ui, sans-serif",
          label: yLabel,
          labelFont: "11px ui-sans-serif, system-ui, sans-serif",
          labelSize: yLabel ? 24 : 0,
          size: 54,
        },
      ],
      series: [
        { label: xLabel ?? "x" },
        ...series.map((spec) => ({
          label: spec.unit ? `${spec.label} [${spec.unit}]` : spec.label,
          stroke: spec.color,
          width: 1.4,
          ...(spec.dashed ? { dash: [5, 3] } : {}),
          ...(spec.step ? { paths: uPlot.paths.stepped!({ align: 1 }) } : {}),
          points: { show: false },
        })),
      ],
      plugins: [markerPlugin(() => markersRef.current), wheelZoomPlugin()],
      hooks: {
        setSelect: [
          (u: uPlot) => {
            if (u.select.width > 0) {
              zoomedRef.current = true;
              onZoomChange?.(true);
            }
          },
        ],
        setScale: [
          (u: uPlot, key: string) => {
            if (key !== "x") return;
            const store = storeRef.current;
            if (store.t.length < 2) return;
            const xScale = u.scales.x;
            if (!xScale) return;
            const min = xScale.min ?? 0;
            const max = xScale.max ?? 0;
            const full = min <= store.t[0]! + 1e-9 && max >= store.t[store.t.length - 1]! - 1e-9;
            if (full && zoomedRef.current) {
              zoomedRef.current = false;
              onZoomChange?.(false);
            }
          },
        ],
      },
    };

    const chart = new uPlot(options, buildData(), container);
    chartRef.current = chart;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) chart.setSize({ width, height });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, height, logScaleY, legend, xLabel, yLabel, themeVersion]);

  useImperativeHandle(
    ref,
    (): ChartHandle => ({
      append: (t, values) => {
        const store = storeRef.current;
        for (const value of t) store.t.push(value);
        for (const [id, column] of Object.entries(values)) {
          const target = (store.values[id] ??= []);
          for (const value of column) target.push(value);
        }
        scheduleFlush();
      },
      replace: (t, values) => {
        storeRef.current = { t: [...t], values: Object.fromEntries(Object.entries(values).map(([id, column]) => [id, [...column]])) };
        zoomedRef.current = false;
        const chart = chartRef.current;
        if (chart) chart.setData(buildData(), true);
      },
      resetZoom: () => {
        const chart = chartRef.current;
        const store = storeRef.current;
        zoomedRef.current = false;
        onZoomChange?.(false);
        if (chart && store.t.length > 1) {
          chart.setScale("x", { min: store.t[0]!, max: store.t[store.t.length - 1]! });
        }
      },
      isZoomed: () => zoomedRef.current,
      exportPng: (filename) => {
        const chart = chartRef.current;
        if (!chart) return;
        const source = chart.ctx.canvas;
        const target = document.createElement("canvas");
        target.width = source.width;
        target.height = source.height;
        const context = target.getContext("2d");
        if (!context) return;
        context.fillStyle = cssVar("--surface-1", "#0f151c");
        context.fillRect(0, 0, target.width, target.height);
        context.drawImage(source, 0, 0);
        target.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `${filename}.png`;
          anchor.click();
          URL.revokeObjectURL(url);
        }, "image/png");
      },
      exportSvg: (filename) => {
        const store = storeRef.current;
        if (store.t.length < 2) return;
        const width = 960;
        const plotHeight = 420;
        const xMin = store.t[0]!;
        const xMax = store.t[store.t.length - 1]!;
        const visible = series.filter((spec) => (store.values[spec.id]?.length ?? 0) > 0);
        const all = visible.flatMap((spec) => store.values[spec.id] ?? []);
        const yMin = Math.min(...all);
        const yMax = Math.max(...all);
        const ySpan = yMax - yMin || 1;
        const xSpan = xMax - xMin || 1;
        const paths = visible
          .map((spec) => {
            const column = store.values[spec.id] ?? [];
            const points = column
              .map((value, index) => {
                const x = ((store.t[index]! - xMin) / xSpan) * width;
                const y = plotHeight - ((value - yMin) / ySpan) * plotHeight;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ");
            return `<polyline fill="none" stroke="${spec.color}" stroke-width="1.2" points="${points}" />`;
          })
          .join("\n");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${plotHeight}" viewBox="0 0 ${width} ${plotHeight}">
<rect width="100%" height="100%" fill="#ffffff" />
${paths}
<text x="6" y="14" font-family="sans-serif" font-size="11" fill="#334155">${yLabel ?? ""} (${yMin.toPrecision(4)} … ${yMax.toPrecision(4)})</text>
<text x="6" y="${plotHeight - 6}" font-family="sans-serif" font-size="11" fill="#334155">${xLabel ?? "x"}: ${xMin.toPrecision(4)} … ${xMax.toPrecision(4)}</text>
</svg>`;
        downloadBlob(`${filename}.svg`, "image/svg+xml", svg);
      },
      exportCsv: (filename) => {
        const store = storeRef.current;
        const headers = [xLabel ?? "x", ...series.map((spec) => (spec.unit ? `${spec.label} [${spec.unit}]` : spec.label))];
        const rows = store.t.map((value, index) => [value, ...series.map((spec) => store.values[spec.id]?.[index] ?? null)]);
        downloadBlob(`${filename}.csv`, "text/csv;charset=utf-8", toCsv(headers, rows));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesKey, xLabel, yLabel],
  );

  return <div ref={containerRef} className={className} style={{ minHeight: height }} />;
});
