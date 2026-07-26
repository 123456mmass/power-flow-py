import type {
  AnalysisConfig,
  SignalDescriptor,
  SimEvent,
  TdsResult,
  TdsSeries,
} from "@/lib/domain/types";
import { findCase, INTEGRATOR_LABELS, MODEL_LABELS } from "@/lib/domain/catalog";

import { gaussian, mulberry32, round } from "../rng";
import type { MockTruth } from "../truth";

const MAX_SAMPLES = 200_000;

interface MachineShape {
  id: number;
  delta0: number;
  amplitude: number;
  frequencyHz: number;
  damping: number;
  phase: number;
  voltage0: number;
  p0: number;
  q0: number;
}

function machines(caseId: string, seed: number): MachineShape[] {
  const descriptor = findCase(caseId);
  const count = Math.max(2, Math.min(8, descriptor?.generators ?? 4));
  const random = mulberry32(seed + 61);
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    delta0: round(12 + 26 * random(), 3),
    amplitude: round(9 + 22 * random(), 3),
    frequencyHz: round(0.55 + 1.35 * random(), 4),
    damping: round(0.9 + 2.6 * random(), 4),
    phase: round(random() * Math.PI, 4),
    voltage0: round(0.99 + 0.06 * random(), 4),
    p0: round(3.2 + 3.4 * random(), 4),
    q0: round(0.5 + 1.1 * random(), 4),
  }));
}

export function buildTsTruth(config: AnalysisConfig, seed: number): MockTruth {
  if (config.analysis !== "ts") throw new Error("buildTsTruth requires a ts config");
  const options = config.options;
  const descriptor = findCase(config.case);
  const random = mulberry32(seed + 7);
  const units = machines(config.case, seed);

  const steps = Math.min(MAX_SAMPLES, Math.max(2, Math.round(options.t_end / options.dt)));
  const dt = options.t_end / steps;
  const faulted = options.fault_bus !== null;
  const tFault = faulted ? options.t_fault : Number.POSITIVE_INFINITY;
  const tClear = faulted ? options.t_clear : Number.POSITIVE_INFINITY;

  const signals: SignalDescriptor[] = [];
  const values: Record<string, number[]> = {};
  const register = (signal: SignalDescriptor) => {
    signals.push(signal);
    values[signal.id] = [];
  };

  for (const unit of units) {
    register({ id: `delta_g${unit.id}`, label: `Rotor angle G${unit.id}`, group: `Generator ${unit.id}`, unit: "deg", panel: "angle", device: `G${unit.id}` });
    register({ id: `freq_g${unit.id}`, label: `Frequency G${unit.id}`, group: `Generator ${unit.id}`, unit: "Hz", panel: "frequency", device: `G${unit.id}` });
    register({ id: `v_g${unit.id}`, label: `Terminal voltage G${unit.id}`, group: `Generator ${unit.id}`, unit: "pu", panel: "voltage", device: `G${unit.id}` });
    register({ id: `p_g${unit.id}`, label: `Active power G${unit.id}`, group: `Generator ${unit.id}`, unit: "pu", panel: "power", device: `G${unit.id}` });
    register({ id: `q_g${unit.id}`, label: `Reactive power G${unit.id}`, group: `Generator ${unit.id}`, unit: "pu", panel: "power", device: `G${unit.id}` });
  }
  register({ id: "residual", label: "Network solve residual", group: "Numerics", unit: "pu", panel: "residual" });
  register({ id: "coi_freq", label: "COI frequency", group: "System", unit: "Hz", panel: "frequency" });

  const time: number[] = new Array(steps);
  let maxAngleDeviation = 0;
  let maxFrequencyDeviation = 0;

  for (let index = 0; index < steps; index += 1) {
    const t = round((index + 1) * dt, 6);
    time[index] = t;
    const afterFault = t >= tFault;
    const afterClear = t >= tClear;
    const since = afterClear ? t - tClear : afterFault ? t - tFault : 0;
    let coi = 0;

    for (const unit of units) {
      const envelope = afterFault ? Math.exp(-unit.damping * since) : 0;
      const swing = afterFault
        ? unit.amplitude * envelope * Math.sin(2 * Math.PI * unit.frequencyHz * since + unit.phase)
        : 0;
      const duringFault = afterFault && !afterClear ? 1 : 0;
      const delta = unit.delta0 + swing + duringFault * unit.amplitude * 0.45 * (t - tFault) / Math.max(dt, tClear - tFault);
      const freqDev = afterFault
        ? (unit.amplitude / 900) * envelope * Math.cos(2 * Math.PI * unit.frequencyHz * since + unit.phase)
        : 0;
      const freq = 60 + freqDev * 60 * 0.06;
      const voltage = unit.voltage0 - duringFault * 0.32 - (afterClear ? 0.05 * envelope * Math.abs(Math.sin(2 * Math.PI * unit.frequencyHz * since)) : 0);
      const p = unit.p0 + (afterFault ? unit.p0 * 0.22 * envelope * Math.sin(2 * Math.PI * unit.frequencyHz * since + unit.phase) : 0) - duringFault * unit.p0 * 0.55;
      const q = unit.q0 + (afterFault ? unit.q0 * 0.4 * envelope * Math.cos(2 * Math.PI * unit.frequencyHz * since) : 0) + duringFault * unit.q0 * 0.9;

      values[`delta_g${unit.id}`]!.push(round(delta, 4));
      values[`freq_g${unit.id}`]!.push(round(freq, 5));
      values[`v_g${unit.id}`]!.push(round(Math.max(0.2, voltage), 5));
      values[`p_g${unit.id}`]!.push(round(p, 5));
      values[`q_g${unit.id}`]!.push(round(q, 5));

      maxAngleDeviation = Math.max(maxAngleDeviation, Math.abs(delta - unit.delta0));
      maxFrequencyDeviation = Math.max(maxFrequencyDeviation, Math.abs(freq - 60));
      coi += freq;
    }

    values.coi_freq!.push(round(coi / units.length, 5));
    const eventSpike = Math.abs(t - tFault) < dt * 1.5 || Math.abs(t - tClear) < dt * 1.5 ? 4e-6 : 0;
    values.residual!.push(Number((1.1e-9 + eventSpike + 3e-10 * Math.abs(gaussian(random))).toPrecision(4)));
  }

  const events: SimEvent[] = faulted
    ? [
        {
          id: "fault-on",
          kind: "fault",
          t: options.t_fault,
          label: `Three-phase fault at bus ${options.fault_bus}`,
          detail: "Bolted shunt fault applied to the network admittance matrix.",
          device: `Bus ${options.fault_bus}`,
          severity: "fault",
        },
        {
          id: "fault-clear",
          kind: "clear",
          t: options.t_clear,
          label: "Fault cleared",
          detail: `Fault removed after ${((options.t_clear - options.t_fault) * 1000).toFixed(0)} ms.`,
          device: `Bus ${options.fault_bus}`,
          severity: "warning",
        },
      ]
    : [];

  const warnings: string[] = [];
  if (maxFrequencyDeviation > 0.6) warnings.push(`Peak frequency excursion ${maxFrequencyDeviation.toFixed(3)} Hz exceeds 0.6 Hz.`);
  if (maxAngleDeviation > 45) warnings.push(`Peak rotor-angle excursion ${maxAngleDeviation.toFixed(1)}° exceeds 45°.`);
  if (options.integrator === "rk4") warnings.push("RK4 is a diagnostic integrator; trapezoidal is the audited production route.");

  const logPlan: MockTruth["logPlan"] = [
    { index: 0, level: "info", source: "loader", message: `Loaded case '${config.case}' (${MODEL_LABELS[options.model]}).` },
    { index: 0, level: "info", source: "init", message: `Initialising states from PF equilibrium; ${units.length} machines.` },
    { index: 0, level: "info", source: "integrator", message: `${INTEGRATOR_LABELS[options.integrator]}, dt = ${(dt * 1000).toFixed(3)} ms, ${steps} steps.` },
  ];
  for (let index = 0; index < steps; index += Math.max(1, Math.floor(steps / 18))) {
    logPlan.push({
      index,
      level: "debug",
      source: "integrator",
      message: `t = ${time[index]?.toFixed(4)} s  residual ${values.residual![index]?.toExponential(2)}  COI ${values.coi_freq![index]?.toFixed(4)} Hz`,
    });
  }
  if (faulted) {
    const faultIndex = Math.max(0, Math.round(options.t_fault / dt) - 1);
    const clearIndex = Math.max(0, Math.round(options.t_clear / dt) - 1);
    logPlan.push({ index: faultIndex, level: "warn", source: "events", message: `Fault applied at bus ${options.fault_bus} (t = ${options.t_fault} s).` });
    logPlan.push({ index: clearIndex, level: "info", source: "events", message: `Fault cleared (t = ${options.t_clear} s).` });
  }
  logPlan.push({
    index: steps - 1,
    level: "info",
    source: "integrator",
    message: `Simulation complete: ${steps} steps, peak |Δδ| ${maxAngleDeviation.toFixed(2)}°.`,
  });

  return {
    time,
    axisLabel: "Simulated time",
    axisUnit: "s",
    signals,
    values,
    events,
    logPlan,
    stages: [
      { fromFraction: 0, label: "Loading case" },
      { fromFraction: 0.06, label: "PF initialisation" },
      { fromFraction: 0.14, label: "Integrating" },
      { fromFraction: 0.96, label: "Assembling series" },
    ],
    targetDurationMs: Math.min(70_000, Math.max(9000, steps * 22)),
    outcome: "converged",
    warnings,
    buildResult: (status, revealed): TdsResult => {
      const count = Math.max(1, Math.min(revealed, steps));
      const series: TdsSeries[] = signals.map((signal) => ({
        signalId: signal.id,
        label: signal.label,
        unit: signal.unit,
        panel: signal.panel,
        values: values[signal.id]!.slice(0, count),
      }));
      return {
        kind: "tds",
        systemName: descriptor?.name ?? config.case,
        model: options.model,
        integrator: options.integrator,
        dt,
        tEnd: time[count - 1] ?? options.t_end,
        converged: status === "converged",
        steps: count,
        time: time.slice(0, count),
        series,
        events: events.filter((event) => event.t <= (time[count - 1] ?? options.t_end)),
        maxAngleDeviationDeg: round(maxAngleDeviation, 4),
        maxFrequencyDeviationHz: round(maxFrequencyDeviation, 5),
      };
    },
  };
}
