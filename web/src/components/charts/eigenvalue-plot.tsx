"use client";

import { useEffect, useRef } from "react";

import type { EigenMode } from "@/lib/domain/types";

import { tokenColor } from "./palette";

export interface EigenvaluePlotProps {
  modes: EigenMode[];
  height?: number;
  /** Damping guide rays, as fractions (0.05 → 5 %). */
  dampingGuides?: number[];
  onSelectMode?: (index: number) => void;
  className?: string;
  title?: string;
}

/**
 * Complex-plane eigenvalue map.
 *
 * Plotly is used here (rather than uPlot) because this panel needs scatter
 * hover metadata, an equal-aspect scientific plane and native PNG/SVG export.
 * It is loaded lazily in the browser only.
 */
export function EigenvaluePlot({
  modes,
  height = 380,
  dampingGuides = [0.03, 0.05, 0.1],
  onSelectMode,
  className,
  title,
}: EigenvaluePlotProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default;
      if (disposed || !containerRef.current) return;

      const fg = tokenColor("--fg-muted", "#94a4b6");
      const grid = tokenColor("--grid-line", "rgba(148,163,184,0.14)");
      const surface = tokenColor("--surface-1", "#0f151c");
      const ok = tokenColor("--ok", "#2bb673");
      const warn = tokenColor("--warn", "#e0a021");
      const danger = tokenColor("--danger", "#ec5c5c");
      const info = tokenColor("--info", "#4aa8f0");

      const colorFor = (mode: EigenMode) =>
        mode.classification === "unstable" ? danger : mode.classification === "marginal" ? warn : ok;

      // Conjugate pairs are shown explicitly so the plane reads symmetrically.
      const points = modes.flatMap((mode) =>
        mode.imag > 0
          ? [
              { ...mode, imagPlot: mode.imag },
              { ...mode, imagPlot: -mode.imag },
            ]
          : [{ ...mode, imagPlot: 0 }],
      );

      const maxImag = Math.max(1, ...points.map((point) => Math.abs(point.imagPlot)));
      const minReal = Math.min(-1, ...points.map((point) => point.real)) * 1.15;
      const maxReal = Math.max(0.5, ...points.map((point) => point.real)) * 1.4;

      const guideTraces = dampingGuides.map((zeta) => {
        const slope = -zeta / Math.sqrt(1 - zeta * zeta);
        const omega = maxImag * 1.05;
        return {
          type: "scatter",
          mode: "lines",
          x: [slope * omega, 0, slope * omega],
          y: [omega, 0, -omega],
          line: { color: info, width: 1, dash: "dot" },
          hoverinfo: "text",
          text: `ζ = ${(zeta * 100).toFixed(0)} %`,
          name: `ζ = ${(zeta * 100).toFixed(0)} %`,
          showlegend: true,
        };
      });

      const data = [
        ...guideTraces,
        {
          type: "scatter",
          mode: "markers",
          x: points.map((point) => point.real),
          y: points.map((point) => point.imagPlot),
          marker: {
            size: 9,
            symbol: "x-thin",
            line: { width: 2, color: points.map(colorFor) },
            color: points.map(colorFor),
          },
          text: points.map(
            (point) =>
              `mode ${point.index}<br>λ = ${point.real.toFixed(4)} ${point.imagPlot >= 0 ? "+" : "-"} j${Math.abs(point.imagPlot).toFixed(4)}` +
              `<br>f = ${point.frequencyHz.toFixed(4)} Hz<br>ζ = ${(point.dampingRatio * 100).toFixed(2)} %<br>state ${point.dominantState}`,
          ),
          customdata: points.map((point) => point.index),
          hoverinfo: "text",
          name: "Eigenvalues",
          showlegend: false,
        },
      ];

      const layout: Record<string, unknown> = {
        height,
        margin: { l: 56, r: 16, t: title ? 28 : 10, b: 44 },
        paper_bgcolor: surface,
        plot_bgcolor: surface,
        font: { color: fg, size: 11, family: "ui-sans-serif, system-ui, sans-serif" },
        ...(title ? { title: { text: title, font: { size: 12 } } } : {}),
        xaxis: {
          title: { text: "Real part σ [1/s]", font: { size: 11 } },
          zeroline: true,
          zerolinecolor: fg,
          zerolinewidth: 1.5,
          gridcolor: grid,
          range: [minReal, maxReal],
        },
        yaxis: {
          title: { text: "Imaginary part ω [rad/s]", font: { size: 11 } },
          zeroline: true,
          zerolinecolor: grid,
          gridcolor: grid,
          range: [-maxImag * 1.12, maxImag * 1.12],
        },
        legend: { orientation: "h", y: -0.22, font: { size: 10 } },
        shapes: [
          {
            type: "rect",
            xref: "x",
            yref: "paper",
            x0: 0,
            x1: maxReal,
            y0: 0,
            y1: 1,
            fillcolor: danger,
            opacity: 0.06,
            line: { width: 0 },
            layer: "below",
          },
        ],
        hovermode: "closest",
      };

      const config: Record<string, unknown> = {
        displaylogo: false,
        responsive: true,
        scrollZoom: true,
        toImageButtonOptions: { format: "svg", filename: "eigenvalues", scale: 2 },
        modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      };

      await Plotly.newPlot(containerRef.current, data, layout, config);

      const plot = containerRef.current as HTMLElement & {
        on?: (event: string, handler: (payload: { points?: { customdata?: number }[] }) => void) => void;
      };
      if (onSelectMode && plot.on) {
        plot.on("plotly_click", (payload) => {
          const index = payload.points?.[0]?.customdata;
          if (typeof index === "number") onSelectMode(index);
        });
      }

      cleanup = () => Plotly.purge(element);
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [dampingGuides, height, modes, onSelectMode, title]);

  return <div ref={containerRef} className={className} style={{ minHeight: height }} />;
}
