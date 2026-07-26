"use client";

import { Activity, Radio, Zap } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/feedback";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { RunStatus, SignalDescriptor, SimEvent } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

export interface DeviceSignalMap {
  id: string;
  label: string;
  bus: number | null;
  mode?: string;
  agsi?: string;
  voltage?: string;
  frequency?: string;
  p?: string;
  q?: string;
}

export interface IbrSwitchAnimationProps {
  caseId: string;
  signals: SignalDescriptor[];
  latest: { t: number | null; values: Record<string, number> };
  events: SimEvent[];
  status: RunStatus;
}

function busFrom(...values: string[]): number | null {
  // Prefer an explicit "bus N" in labels/groups. Mock device ids such as
  // "ibr1" identify the converter, not its electrical bus.
  for (const value of values) {
    const match = value.match(/bus[. _-]*(\d+)/i);
    const parsed = Number(match?.[1]);
    if (Number.isInteger(parsed)) return parsed;
  }
  for (const value of values) {
    const match = value.match(/ibr[. _-]*(\d+)/i);
    const parsed = Number(match?.[1]);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function signalRole(signal: SignalDescriptor): keyof Omit<DeviceSignalMap, "id" | "label" | "bus"> | null {
  if (signal.panel === "mode") return "mode";
  if (signal.panel === "agsi") return "agsi";
  if (signal.panel === "voltage") return "voltage";
  if (signal.panel === "frequency") return "frequency";
  if (signal.panel === "power") {
    const text = `${signal.id} ${signal.label}`.toLowerCase();
    return /reactive|(^|[._-])q([._-]|$)/.test(text) ? "q" : "p";
  }
  return null;
}

export function deriveIbrDevices(signals: SignalDescriptor[]): DeviceSignalMap[] {
  const devices = new Map<string, DeviceSignalMap>();
  for (const signal of signals) {
    if (!signal.device) continue;
    const role = signalRole(signal);
    if (!role) continue;
    const key = signal.device;
    const current = devices.get(key) ?? {
      id: key,
      label: /^ibrs?$/i.test(signal.group) ? signal.device : signal.group || signal.device,
      bus: busFrom(signal.device, signal.group, signal.label, signal.id),
    };
    current[role] = signal.id;
    devices.set(key, current);
  }
  for (const device of devices.values()) {
    if (device.voltage || device.bus === null) continue;
    const voltage = signals.find(
      (signal) => signal.panel === "voltage" && busFrom(signal.label, signal.id) === device.bus,
    );
    if (voltage) device.voltage = voltage.id;
  }
  return [...devices.values()]
    .filter((device) => device.mode || device.agsi)
    .sort((a, b) => (a.bus ?? 999) - (b.bus ?? 999));
}

function eventMatchesDevice(event: SimEvent | undefined, device: DeviceSignalMap): boolean {
  if (!event) return false;
  const haystack = `${event.device ?? ""} ${event.label}`.toLowerCase();
  return [device.id, device.label, device.bus === null ? "" : `bus ${device.bus}`, device.bus === null ? "" : `ibr ${device.bus}`]
    .filter(Boolean)
    .some((token) => haystack.includes(token.toLowerCase()));
}

function display(value: number | undefined, digits: number, suffix = ""): string {
  return value === undefined ? "—" : `${formatNumber(value, digits)}${suffix}`;
}

export function IbrSwitchAnimation({ caseId, signals, latest, events, status }: IbrSwitchAnimationProps) {
  const devices = useMemo(() => deriveIbrDevices(signals), [signals]);
  const activeEvent = events
    .filter((event) => event.kind === "mode_switch" && event.t <= (latest.t ?? Number.POSITIVE_INFINITY))
    .reduce<SimEvent | undefined>((current, event) => (!current || event.t >= current.t ? event : current), undefined);
  const flashEvent = activeEvent && latest.t !== null && latest.t - activeEvent.t < 0.65 ? activeEvent : undefined;
  const lastGridEvent = events
    .filter((event) => (event.kind === "trip" || event.kind === "reclose") && event.t <= (latest.t ?? Number.POSITIVE_INFINITY))
    .reduce<SimEvent | undefined>((current, event) => (!current || event.t >= current.t ? event : current), undefined);
  const gridOnline = lastGridEvent?.kind !== "trip";
  const inFault = events.some((event) => {
    if (event.kind !== "fault" || event.t > (latest.t ?? -1)) return false;
    const clear = events.find((candidate) => candidate.kind === "clear" && candidate.t >= event.t);
    return !clear || clear.t > (latest.t ?? -1);
  });
  const running = status === "running" || status === "initializing";

  if (devices.length === 0) return null;

  return (
    <Panel className="overflow-hidden" data-testid="ibr-switch-animation">
      <PanelHeader
        title="Live GFL / GFM switching one-line"
        subtitle={`${caseId} · telemetry-driven, not a scripted UI animation`}
        actions={
          <div className="flex items-center gap-1.5">
            {inFault ? <Badge tone="danger">FAULT ACTIVE</Badge> : null}
            <Badge tone={running ? "ok" : "neutral"}>
              <Radio aria-hidden className={cn("size-3", running && "live-dot")} />
              {running ? "LIVE" : status.toUpperCase()}
            </Badge>
            <span className="num text-[11px] text-fg-subtle">t = {display(latest.t ?? undefined, 4, " s")}</span>
          </div>
        }
      />

      <div className="grid gap-3 p-3 xl:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col justify-center rounded border border-line bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <span className={cn("grid-source", gridOnline ? "grid-source-online" : "grid-source-offline")}>
              <Activity aria-hidden className="size-5" />
            </span>
            <div>
              <p className="text-[12.5px] font-semibold">Utility grid / SG</p>
              <p className={cn("text-[11px]", gridOnline ? "text-ok" : "text-danger")}>{gridOnline ? "breaker closed" : "breaker open"}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5" aria-label={`Grid breaker ${gridOnline ? "closed" : "open"}`}>
            <span className="h-px flex-1 bg-line-strong" />
            <span className={cn("breaker", gridOnline ? "breaker-closed" : "breaker-open")} />
            <span className="h-px flex-1 bg-line-strong" />
          </div>
          <p className="mt-2 text-[10.5px] leading-4 text-fg-subtle">Trip/reclose events operate this breaker at simulated event time.</p>
        </div>

        <div className="relative min-w-0">
          <div className="absolute left-0 right-0 top-[31px] h-[3px] rounded bg-line-strong" aria-hidden />
          <div className={cn("power-flow-track absolute left-0 right-0 top-[30px]", running && gridOnline && "power-flow-track-live")} aria-hidden />
          <div className="relative grid gap-2" style={{ gridTemplateColumns: `repeat(${devices.length}, minmax(148px, 1fr))` }}>
            {devices.map((device) => {
              const modeValue = device.mode ? latest.values[device.mode] : undefined;
              const mode = modeValue !== undefined && modeValue >= 0.5 ? "GFM" : "GFL";
              const agsi = device.agsi ? latest.values[device.agsi] : undefined;
              const switching = eventMatchesDevice(flashEvent, device);
              const voltage = device.voltage ? latest.values[device.voltage] : undefined;
              const frequency = device.frequency ? latest.values[device.frequency] : undefined;
              const p = device.p ? latest.values[device.p] : undefined;
              const q = device.q ? latest.values[device.q] : undefined;
              return (
                <article key={device.id} className={cn("ibr-device", mode === "GFM" ? "ibr-device-gfm" : "ibr-device-gfl", switching && "ibr-device-switching")}>
                  <div className="relative z-10 mx-auto flex size-16 items-center justify-center rounded-full border-2 bg-surface-1 shadow-sm">
                    <Zap aria-hidden className="size-6" />
                    {switching ? <span className="switch-ripple" aria-hidden /> : null}
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold" title={device.label}>{device.label}</p>
                      <p className="num text-[10.5px] text-fg-subtle">{device.bus === null ? device.id : `bus ${device.bus}`}</p>
                    </div>
                    <Badge tone={mode === "GFM" ? "warn" : "info"}>{mode}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10.5px]">
                    <span className="text-fg-subtle">V</span><span className="num text-right">{display(voltage, 3, " pu")}</span>
                    <span className="text-fg-subtle">f</span><span className="num text-right">{display(frequency, 3, " Hz")}</span>
                    <span className="text-fg-subtle">P / Q</span><span className="num text-right">{display(p, 3)} / {display(q, 3)}</span>
                  </div>
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px]"><span className="text-fg-subtle">AGSI++</span><span className="num">{display(agsi, 3)}</span></div>
                    <div className="agsi-gauge" title="GFM arm threshold 0.65 · GFL return threshold 0.35">
                      <span className="agsi-threshold agsi-threshold-low" />
                      <span className="agsi-threshold agsi-threshold-high" />
                      <span className={cn("agsi-fill", agsi !== undefined && agsi >= 0.65 ? "bg-danger" : agsi !== undefined && agsi >= 0.35 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.max(0, Math.min(100, (agsi ?? 0) * 100))}%` }} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface-2 px-3 py-1.5 text-[10.5px] text-fg-subtle">
        <span><i className="mr-1 inline-block size-2 rounded-full bg-info" />GFL follows grid angle</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-warn" />GFM establishes voltage/frequency</span>
        <span>AGSI thresholds: <b className="num text-fg">0.65</b> arm GFM · <b className="num text-fg">0.35</b> hand back to GFL</span>
        {activeEvent ? <span className="ml-auto num text-fg-muted">last: {activeEvent.label} @ {formatNumber(activeEvent.t, 4)} s</span> : null}
      </div>
    </Panel>
  );
}
