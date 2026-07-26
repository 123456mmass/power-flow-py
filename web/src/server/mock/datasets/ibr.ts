import type {
  AnalysisConfig,
  AnalysisResult,
  BranchRow,
  BusRow,
  PfResult,
  SignalDescriptor,
  SimEvent,
  SwitchTransaction,
  SwitchingResult,
  TdsSeries,
} from "@/lib/domain/types";
import { findCase, IBR_PRODUCT_LABELS } from "@/lib/domain/catalog";

import { gaussian, mulberry32, round } from "../rng";
import type { MockTruth } from "../truth";
import { buildEigenModes } from "./sssa";

const MAX_SAMPLES = 200_000;

export interface IbrDevice {
  id: string;
  label: string;
  type: "SG" | "GFL" | "GFM";
  bus: number;
  /** Devices that can re-arm between GFL and GFM under AGSI++. */
  switchable: boolean;
  p0: number;
  q0: number;
  v0: number;
}

function devicesFor(caseId: string): IbrDevice[] {
  if (caseId === "ieee14_switch") {
    return [
      { id: "sg1", label: "SG 1 (bus 1)", type: "SG", bus: 1, switchable: false, p0: 2.32, q0: -0.17, v0: 1.06 },
      { id: "ibr1", label: "IBR 1 (bus 2)", type: "GFL", bus: 2, switchable: true, p0: 0.4, q0: 0.42, v0: 1.045 },
      { id: "ibr2", label: "IBR 2 (bus 3)", type: "GFM", bus: 3, switchable: true, p0: 0.35, q0: 0.23, v0: 1.01 },
      { id: "ibr3", label: "IBR 3 (bus 6)", type: "GFL", bus: 6, switchable: true, p0: 0.3, q0: 0.12, v0: 1.07 },
      { id: "ibr4", label: "IBR 4 (bus 8)", type: "GFM", bus: 8, switchable: true, p0: 0.25, q0: 0.17, v0: 1.09 },
    ];
  }
  if (caseId === "padiyar_switch") {
    return [
      { id: "sg1", label: "SG 1 (bus 1)", type: "SG", bus: 1, switchable: false, p0: 4.5, q0: 0.6, v0: 1.03 },
      { id: "ibr1", label: "IBR 1 (bus 2)", type: "GFL", bus: 2, switchable: true, p0: 1.2, q0: 0.2, v0: 1.01 },
      { id: "ibr2", label: "IBR 2 (bus 3)", type: "GFM", bus: 3, switchable: true, p0: 1.1, q0: 0.25, v0: 1.02 },
      { id: "ibr3", label: "IBR 3 (bus 10)", type: "GFL", bus: 10, switchable: true, p0: 0.9, q0: 0.15, v0: 1.0 },
    ];
  }
  if (caseId === "two_ibr_switch") {
    return [
      { id: "ibr1", label: "IBR A (PCC)", type: "GFL", bus: 2, switchable: true, p0: 0.8, q0: 0.1, v0: 1.0 },
      { id: "ibr2", label: "IBR B (PCC)", type: "GFM", bus: 2, switchable: true, p0: 0.7, q0: 0.15, v0: 1.0 },
    ];
  }
  const isGfm = caseId.includes("gfm");
  return [
    {
      id: "ibr1",
      label: isGfm ? "GFM converter" : "GFL converter",
      type: isGfm ? "GFM" : "GFL",
      bus: 2,
      switchable: false,
      p0: 0.9,
      q0: 0.05,
      v0: 1.0,
    },
  ];
}

interface EventPlan {
  faultOn: number;
  faultClear: number;
  trip: number | null;
  reclose: number | null;
  switchTimes: { t: number; device: IbrDevice; to: "GFM" | "GFL"; trigger: string }[];
}

function planEvents(caseId: string, tEnd: number, devices: IbrDevice[], options: { faultOn: number; faultClear: number }): EventPlan {
  const switching = caseId.endsWith("_switch");
  const faultOn = options.faultOn > 0 ? options.faultOn : round(tEnd * 0.2, 4);
  const faultClear = options.faultClear > options.faultOn ? options.faultClear : round(faultOn + Math.min(0.14, tEnd * 0.02), 4);
  if (!switching) {
    return { faultOn, faultClear, trip: null, reclose: null, switchTimes: [] };
  }
  const trip = round(tEnd * 0.42, 4);
  const reclose = round(tEnd * 0.7, 4);
  const switchable = devices.filter((device) => device.switchable);
  const toGfm = switchable.filter((device) => device.type === "GFL");
  const switchTimes: EventPlan["switchTimes"] = [];
  toGfm.forEach((device, index) => {
    switchTimes.push({
      t: round(trip + 0.03 + index * 0.02, 4),
      device,
      to: "GFM",
      trigger: "AGSI++ below grid-strength floor after SG trip",
    });
    switchTimes.push({
      t: round(reclose + 0.12 + index * 0.02, 4),
      device,
      to: "GFL",
      trigger: "AGSI++ recovered above re-arm hysteresis",
    });
  });
  return { faultOn, faultClear, trip, reclose, switchTimes };
}

function buildPfEquilibrium(caseId: string, devices: IbrDevice[]): PfResult {
  const descriptor = findCase(caseId);
  const buses: BusRow[] = devices.map((device, index) => ({
    busId: device.bus,
    name: `${device.label}`,
    type: index === 0 ? "REF" : "PV",
    vMagPu: device.v0,
    vAngleDeg: round(-1.2 * index, 3),
    pGenMw: round(device.p0 * 100, 2),
    qGenMvar: round(device.q0 * 100, 2),
    pLoadMw: 0,
    qLoadMvar: 0,
    qLimitHit: "none",
  }));
  const branches: BranchRow[] = devices.map((device, index) => ({
    branchId: index + 1,
    fromBus: device.bus,
    toBus: 1,
    pFromMw: round(device.p0 * 100, 2),
    qFromMvar: round(device.q0 * 100, 2),
    pToMw: round(-device.p0 * 100 + 0.4, 2),
    qToMvar: round(-device.q0 * 100 + 0.8, 2),
    pLossMw: 0.4,
    qLossMvar: 0.8,
    loadingPct: round(45 + 12 * index, 1),
  }));
  return {
    kind: "pf",
    systemName: descriptor?.name ?? caseId,
    method: "newton_raphson",
    converged: true,
    reason: "tolerance_met",
    finiteStatus: "all_finite",
    iterations: 4,
    maxMismatch: 2.4e-11,
    mismatchHistory: [0.14, 4.2e-3, 6.1e-6, 2.4e-11],
    pLossTotalMw: round(branches.length * 0.4, 3),
    qLossTotalMvar: round(branches.length * 0.8, 3),
    pTotalGenMw: round(buses.reduce((sum, bus) => sum + bus.pGenMw, 0), 3),
    qTotalGenMvar: round(buses.reduce((sum, bus) => sum + bus.qGenMvar, 0), 3),
    pTotalLoadMw: 0,
    qTotalLoadMvar: 0,
    buses,
    branches,
    qLimitEvents: [],
  };
}

export function buildIbrTruth(config: AnalysisConfig, seed: number): MockTruth {
  if (config.analysis !== "ibr") throw new Error("buildIbrTruth requires an ibr config");
  const options = config.options;
  const descriptor = findCase(config.case);
  const devices = devicesFor(config.case);
  const random = mulberry32(seed + 23);
  const product = options.ibr_analysis;

  if (product === "sssa" || product === "sssa_load_sweep") {
    const modes = buildEigenModes(config.case, "emf6", seed);
    const sweep = product === "sssa_load_sweep" ? options.sssa_load_percentages : [];
    const time = sweep.length > 0 ? sweep.map((_, index) => index + 1) : modes.map((_, index) => index + 1);
    const damping = sweep.length > 0
      ? sweep.map((percentage) => round(0.11 - percentage * 0.00075, 5))
      : modes.map((mode) => mode.dampingRatio);
    const minDamping = Math.min(...damping);
    return {
      time,
      axisLabel: sweep.length > 0 ? "Load point" : "Mode index",
      axisUnit: "",
      signals: [
        { id: "min_damping", label: "Minimum damping ratio", group: "Modes", unit: "-", panel: "mode" },
        { id: "residual", label: "Equilibrium residual", group: "Numerics", unit: "pu", panel: "residual" },
      ],
      values: {
        min_damping: damping,
        residual: time.map((_, index) => Number((3e-9 * (index + 1)).toPrecision(4))),
      },
      events: [],
      logPlan: [
        { index: 0, level: "info", source: "loader", message: `Loaded IBR case '${config.case}' for ${IBR_PRODUCT_LABELS[product]}.` },
        ...(sweep.length > 0
          ? sweep.map((percentage, index) => ({
              index,
              level: "info" as const,
              source: "sweep",
              message: `load ${percentage.toFixed(0)} %: min damping ${(damping[index]! * 100).toFixed(2)} %`,
            }))
          : [{ index: 0, level: "info" as const, source: "schur", message: "Schur decomposition of the reduced state matrix." }]),
        { index: time.length - 1, level: minDamping < 0.03 ? "warn" : "info", source: "classify", message: `Worst damping ${(minDamping * 100).toFixed(2)} %.` },
      ],
      stages: [
        { fromFraction: 0, label: "Loading case" },
        { fromFraction: 0.15, label: "Equilibrium" },
        { fromFraction: 0.5, label: "Schur SSSA" },
        { fromFraction: 0.9, label: "Classifying" },
      ],
      targetDurationMs: 8000 + Math.round(2500 * random()),
      outcome: "converged",
      warnings: minDamping < 0.03 ? [`Worst-case damping ${(minDamping * 100).toFixed(2)} % below 3 %.`] : [],
      buildResult: (): AnalysisResult => ({
        kind: "sssa",
        systemName: descriptor?.name ?? config.case,
        model: "ibr-schur",
        stable: minDamping > 0,
        classification: minDamping > 0.03 ? "stable" : minDamping > 0 ? "stable, poorly damped" : "unstable",
        stateCount: modes.length,
        modes,
        minDampingRatio: round(minDamping, 5),
        criticalModeIndex: modes.reduce((best, mode) => (mode.dampingRatio < (modes[best - 1]?.dampingRatio ?? 1) ? mode.index : best), 1),
        coiReduction: false,
      }),
    };
  }

  if (product === "pf") {
    const equilibrium = buildPfEquilibrium(config.case, devices);
    return {
      time: equilibrium.mismatchHistory.map((_, index) => index + 1),
      axisLabel: "Iteration",
      axisUnit: "",
      signals: [{ id: "residual", label: "Equilibrium residual", group: "Numerics", unit: "pu", panel: "residual" }],
      values: { residual: equilibrium.mismatchHistory },
      events: [],
      logPlan: [
        { index: 0, level: "info", source: "loader", message: `Loaded IBR case '${config.case}' (PF equilibrium).` },
        ...equilibrium.mismatchHistory.map((value, index) => ({
          index,
          level: "debug" as const,
          source: "equilibrium",
          message: `iter ${index + 1}: residual ${value.toExponential(3)} pu`,
        })),
      ],
      stages: [
        { fromFraction: 0, label: "Loading case" },
        { fromFraction: 0.3, label: "Equilibrium" },
      ],
      targetDurationMs: 4200,
      outcome: "converged",
      warnings: [],
      buildResult: () => equilibrium,
    };
  }

  /* -------------------------------------------------- time-domain / full ---- */

  const steps = Math.min(MAX_SAMPLES, Math.max(4, Math.round(options.t_end / options.dt)));
  const dt = options.t_end / steps;
  const plan = planEvents(config.case, options.t_end, devices, {
    faultOn: options.fault_on,
    faultClear: options.fault_clear,
  });

  const signals: SignalDescriptor[] = [];
  const values: Record<string, number[]> = {};
  const register = (signal: SignalDescriptor) => {
    signals.push(signal);
    values[signal.id] = [];
  };

  for (const device of devices) {
    register({ id: `v_${device.id}`, label: `PCC voltage ${device.label}`, group: device.label, unit: "pu", panel: "voltage", device: device.id });
    register({ id: `f_${device.id}`, label: `Frequency ${device.label}`, group: device.label, unit: "Hz", panel: "frequency", device: device.id });
    register({ id: `p_${device.id}`, label: `Active power ${device.label}`, group: device.label, unit: "pu", panel: "power", device: device.id });
    register({ id: `q_${device.id}`, label: `Reactive power ${device.label}`, group: device.label, unit: "pu", panel: "power", device: device.id });
    register({ id: `angle_${device.id}`, label: `Angle ${device.label}`, group: device.label, unit: "deg", panel: "angle", device: device.id });
    if (device.type !== "SG") {
      register({ id: `agsi_${device.id}`, label: `AGSI++ ${device.label}`, group: device.label, unit: "-", panel: "agsi", device: device.id });
      register({ id: `mode_${device.id}`, label: `Control mode ${device.label}`, group: device.label, unit: "0=GFL 1=GFM", panel: "mode", device: device.id });
    }
  }
  register({ id: "residual", label: "Network solve residual", group: "Numerics", unit: "pu", panel: "residual" });

  const modeState = new Map<string, "GFL" | "GFM">();
  for (const device of devices) modeState.set(device.id, device.type === "GFM" ? "GFM" : "GFL");

  const transactions: SwitchTransaction[] = [];
  const time: number[] = new Array(steps);
  const tripped = { active: false };

  for (let index = 0; index < steps; index += 1) {
    const t = round((index + 1) * dt, 6);
    time[index] = t;
    const inFault = t >= plan.faultOn && t < plan.faultClear;
    if (plan.trip !== null && t >= plan.trip) tripped.active = plan.reclose === null || t < plan.reclose;
    const sinceFault = Math.max(0, t - plan.faultClear);
    const sinceTrip = plan.trip === null ? 0 : Math.max(0, t - plan.trip);
    const sinceReclose = plan.reclose === null ? 0 : Math.max(0, t - plan.reclose);
    const ring = (since: number, freq: number, damp: number) => Math.exp(-damp * since) * Math.sin(2 * Math.PI * freq * since);

    // Grid-strength index: healthy ≈ 0.86, collapses while the SG is out.
    const agsiBase = 0.86 - (inFault ? 0.45 : 0) - (tripped.active ? 0.42 : 0) + 0.05 * ring(sinceReclose, 1.4, 2.2);

    for (const device of devices) {
      const isSg = device.type === "SG";
      const sgOut = tripped.active && isSg;
      const disturbance =
        0.11 * ring(sinceFault, 2.4, 3.6) + (tripped.active ? 0.06 * ring(sinceTrip, 1.1, 1.4) : 0) + 0.04 * ring(sinceReclose, 3.1, 4.5);
      const mode = modeState.get(device.id) ?? "GFL";

      const voltage = sgOut
        ? 0
        : Math.max(0.05, device.v0 - (inFault ? 0.55 : 0) + disturbance * (mode === "GFM" ? 0.5 : 1));
      const frequency = sgOut ? 0 : 60 + (inFault ? -0.22 : 0) + 0.55 * disturbance + (tripped.active && !isSg ? -0.18 : 0);
      const activePower = sgOut ? 0 : device.p0 * (inFault ? 0.35 : 1) + device.p0 * 0.28 * disturbance;
      const reactivePower = sgOut ? 0 : device.q0 + (inFault ? 0.55 : 0) + 0.22 * disturbance;
      const angle = sgOut ? 0 : round(-4 - 10 * devices.indexOf(device) + 14 * disturbance, 4);

      values[`v_${device.id}`]!.push(round(voltage, 5));
      values[`f_${device.id}`]!.push(round(frequency, 5));
      values[`p_${device.id}`]!.push(round(activePower, 5));
      values[`q_${device.id}`]!.push(round(reactivePower, 5));
      values[`angle_${device.id}`]!.push(angle);
      if (device.type !== "SG") {
        const agsi = Math.min(1, Math.max(0, agsiBase + (mode === "GFM" ? 0.12 : 0) + 0.01 * gaussian(random)));
        values[`agsi_${device.id}`]!.push(round(agsi, 5));
        values[`mode_${device.id}`]!.push(mode === "GFM" ? 1 : 0);
      }
    }

    for (const entry of plan.switchTimes) {
      if (Math.abs(t - entry.t) < dt / 2) {
        modeState.set(entry.device.id, entry.to);
        transactions.push({
          id: `sw-${transactions.length + 1}`,
          t,
          device: entry.device.label,
          from: entry.to === "GFM" ? "GFL" : "GFM",
          to: entry.to,
          trigger: entry.trigger,
          agsi: round(Math.min(1, Math.max(0, agsiBase)), 4),
          vPccPu: round(values[`v_${entry.device.id}`]!.at(-1) ?? entry.device.v0, 4),
          accepted: true,
          note: entry.to === "GFM" ? "Virtual-impedance ramp armed" : "PLL re-synchronised before hand-back",
        });
      }
    }

    const spike =
      [plan.faultOn, plan.faultClear, plan.trip, plan.reclose, ...plan.switchTimes.map((item) => item.t)]
        .filter((item): item is number => item !== null)
        .some((item) => Math.abs(t - item) < dt * 1.5)
        ? 8e-6
        : 0;
    values.residual!.push(Number((2.1e-9 + spike + 4e-10 * Math.abs(gaussian(random))).toPrecision(4)));
  }

  const events: SimEvent[] = [
    {
      id: "fault-on",
      kind: "fault",
      t: plan.faultOn,
      label: "PCC shunt fault applied",
      detail: `Fault reactance ${options.fault_reactance.toFixed(3)} pu at the common PCC.`,
      device: null,
      severity: "fault",
    },
    {
      id: "fault-clear",
      kind: "clear",
      t: plan.faultClear,
      label: "Fault cleared",
      detail: `Cleared after ${((plan.faultClear - plan.faultOn) * 1000).toFixed(0)} ms.`,
      device: null,
      severity: "warning",
    },
  ];
  if (plan.trip !== null) {
    events.push({
      id: "sg-trip",
      kind: "trip",
      t: plan.trip,
      label: "Synchronous generator tripped",
      detail: "SG 1 breaker opened; network becomes inverter-dominated.",
      device: "sg1",
      severity: "fault",
    });
  }
  if (plan.reclose !== null) {
    events.push({
      id: "sg-reclose",
      kind: "reclose",
      t: plan.reclose,
      label: "Synchronous generator reclosed",
      detail: "SG 1 breaker reclosed after synchronism check.",
      device: "sg1",
      severity: "info",
    });
  }
  for (const [index, entry] of plan.switchTimes.entries()) {
    events.push({
      id: `mode-${index}`,
      kind: "mode_switch",
      t: entry.t,
      label: `${entry.device.label}: ${entry.to === "GFM" ? "GFL → GFM" : "GFM → GFL"}`,
      detail: entry.trigger,
      device: entry.device.id,
      severity: entry.to === "GFM" ? "warning" : "info",
    });
  }
  events.sort((a, b) => a.t - b.t);

  const warnings: string[] = [];
  const minVoltage = Math.min(
    ...devices
      .filter((device) => device.type !== "SG")
      .map((device) => Math.min(...values[`v_${device.id}`]!)),
  );
  if (minVoltage < 0.5) warnings.push(`PCC voltage dipped to ${minVoltage.toFixed(3)} pu during the fault.`);
  if (transactions.length > 0) warnings.push(`${transactions.length} AGSI++ control-mode transitions were executed.`);
  if (descriptor?.readiness === "diagnostic") {
    warnings.push("Case readiness is ASSUMED_DIAGNOSTIC; results are not production-certified.");
  }

  const logPlan: MockTruth["logPlan"] = [
    { index: 0, level: "info", source: "loader", message: `Loaded IBR case '${config.case}' with ${devices.length} devices.` },
    { index: 0, level: "info", source: "init", message: `AGSI++ supervisor armed for ${devices.filter((d) => d.switchable).length} switchable devices.` },
    { index: 0, level: "info", source: "integrator", message: `Implicit trapezoidal, dt = ${(dt * 1000).toFixed(3)} ms, ${steps} steps.` },
  ];
  for (let index = 0; index < steps; index += Math.max(1, Math.floor(steps / 24))) {
    logPlan.push({
      index,
      level: "debug",
      source: "integrator",
      message: `t = ${time[index]?.toFixed(4)} s  residual ${values.residual![index]?.toExponential(2)}`,
    });
  }
  for (const event of events) {
    const index = Math.max(0, Math.min(steps - 1, Math.round(event.t / dt) - 1));
    logPlan.push({
      index,
      level: event.severity === "fault" ? "warn" : event.severity === "warning" ? "warn" : "info",
      source: event.kind === "mode_switch" ? "agsi" : "events",
      message: `${event.label} (t = ${event.t.toFixed(4)} s) — ${event.detail}`,
    });
  }
  logPlan.push({
    index: steps - 1,
    level: "info",
    source: "integrator",
    message: `Simulation complete: ${steps} steps, ${transactions.length} switch transactions.`,
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
      { fromFraction: 0.05, label: "PF equilibrium" },
      { fromFraction: 0.12, label: "Integrating with AGSI++ supervisor" },
      { fromFraction: 0.97, label: "Assembling transactions" },
    ],
    targetDurationMs: Math.min(80_000, Math.max(12_000, steps * 18)),
    outcome: "converged",
    warnings,
    buildResult: (status, revealed): SwitchingResult => {
      const count = Math.max(1, Math.min(revealed, steps));
      const cut = time[count - 1] ?? options.t_end;
      const series: TdsSeries[] = signals.map((signal) => ({
        signalId: signal.id,
        label: signal.label,
        unit: signal.unit,
        panel: signal.panel,
        values: values[signal.id]!.slice(0, count),
      }));
      return {
        kind: "switching",
        systemName: descriptor?.name ?? config.case,
        model: config.case.endsWith("_switch") ? "agsi++" : "ibr",
        integrator: "trapezoidal",
        dt,
        tEnd: cut,
        converged: status === "converged",
        steps: count,
        time: time.slice(0, count),
        series,
        events: events.filter((event) => event.t <= cut),
        maxAngleDeviationDeg: round(
          Math.max(...devices.map((device) => Math.max(...values[`angle_${device.id}`]!.slice(0, count).map(Math.abs)))),
          4,
        ),
        maxFrequencyDeviationHz: round(
          Math.max(
            ...devices.map((device) =>
              Math.max(...values[`f_${device.id}`]!.slice(0, count).map((item) => (item === 0 ? 0 : Math.abs(item - 60)))),
            ),
          ),
          5,
        ),
        transactions: transactions.filter((item) => item.t <= cut),
        devices: devices.map((device) => ({ id: device.id, label: device.label, type: device.type, bus: device.bus })),
      };
    },
  };
}
