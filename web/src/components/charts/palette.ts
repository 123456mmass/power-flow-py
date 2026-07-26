import type { SignalPanel } from "@/lib/domain/types";

const SERIES_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
];

const FALLBACKS = ["#22d3ee", "#f59e0b", "#a78bfa", "#4ade80", "#f472b6", "#60a5fa", "#fbbf24", "#34d399"];

export function seriesColor(index: number): string {
  if (typeof window === "undefined") return FALLBACKS[index % FALLBACKS.length]!;
  const variable = SERIES_VARS[index % SERIES_VARS.length]!;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || FALLBACKS[index % FALLBACKS.length]!;
}

export function tokenColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const PANEL_TITLES: Record<SignalPanel, string> = {
  voltage: "Voltage",
  angle: "Angle",
  frequency: "Frequency",
  power: "Active / reactive power",
  agsi: "AGSI++ grid-strength index",
  mode: "Device control mode",
  residual: "Solver residual",
};

export const PANEL_UNITS: Record<SignalPanel, string> = {
  voltage: "pu",
  angle: "deg",
  frequency: "Hz",
  power: "pu",
  agsi: "-",
  mode: "0=GFL 1=GFM",
  residual: "pu",
};

export const PANEL_ORDER: SignalPanel[] = ["voltage", "frequency", "angle", "power", "agsi", "mode", "residual"];

export function markerColor(severity: "info" | "warning" | "fault"): string {
  if (severity === "fault") return tokenColor("--danger", "#ec5c5c");
  if (severity === "warning") return tokenColor("--warn", "#e0a021");
  return tokenColor("--info", "#4aa8f0");
}
