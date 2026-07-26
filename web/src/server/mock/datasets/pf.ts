import type {
  AnalysisConfig,
  BranchRow,
  BusRow,
  PfOptions,
  PfResult,
  QLimitEventRow,
  SignalDescriptor,
} from "@/lib/domain/types";
import { findCase, PF_METHOD_LABELS } from "@/lib/domain/catalog";

import { gaussian, mulberry32, round } from "../rng";
import type { MockTruth } from "../truth";

/**
 * Tabulated IEEE 14-bus reference solution used as the mock PF dataset.
 * Values are display fixtures for the frontend only; the authoritative numbers
 * come from the Python solver in a live deployment.
 */
const IEEE14_BUSES: BusRow[] = [
  { busId: 1, name: "Bus 01", type: "REF", vMagPu: 1.06, vAngleDeg: 0, pGenMw: 232.39, qGenMvar: -16.89, pLoadMw: 0, qLoadMvar: 0, qLimitHit: "none" },
  { busId: 2, name: "Bus 02", type: "PV", vMagPu: 1.045, vAngleDeg: -4.98, pGenMw: 40, qGenMvar: 42.4, pLoadMw: 21.7, qLoadMvar: 12.7, qLimitHit: "none" },
  { busId: 3, name: "Bus 03", type: "PV", vMagPu: 1.01, vAngleDeg: -12.72, pGenMw: 0, qGenMvar: 23.39, pLoadMw: 94.2, qLoadMvar: 19, qLimitHit: "none" },
  { busId: 4, name: "Bus 04", type: "PQ", vMagPu: 1.0177, vAngleDeg: -10.33, pGenMw: 0, qGenMvar: 0, pLoadMw: 47.8, qLoadMvar: -3.9, qLimitHit: "none" },
  { busId: 5, name: "Bus 05", type: "PQ", vMagPu: 1.0195, vAngleDeg: -8.78, pGenMw: 0, qGenMvar: 0, pLoadMw: 7.6, qLoadMvar: 1.6, qLimitHit: "none" },
  { busId: 6, name: "Bus 06", type: "PV", vMagPu: 1.07, vAngleDeg: -14.22, pGenMw: 0, qGenMvar: 12.24, pLoadMw: 11.2, qLoadMvar: 7.5, qLimitHit: "none" },
  { busId: 7, name: "Bus 07", type: "PQ", vMagPu: 1.0615, vAngleDeg: -13.37, pGenMw: 0, qGenMvar: 0, pLoadMw: 0, qLoadMvar: 0, qLimitHit: "none" },
  { busId: 8, name: "Bus 08", type: "PV", vMagPu: 1.09, vAngleDeg: -13.36, pGenMw: 0, qGenMvar: 17.36, pLoadMw: 0, qLoadMvar: 0, qLimitHit: "max" },
  { busId: 9, name: "Bus 09", type: "PQ", vMagPu: 1.0559, vAngleDeg: -14.94, pGenMw: 0, qGenMvar: 0, pLoadMw: 29.5, qLoadMvar: 16.6, qLimitHit: "none" },
  { busId: 10, name: "Bus 10", type: "PQ", vMagPu: 1.0510, vAngleDeg: -15.1, pGenMw: 0, qGenMvar: 0, pLoadMw: 9, qLoadMvar: 5.8, qLimitHit: "none" },
  { busId: 11, name: "Bus 11", type: "PQ", vMagPu: 1.0569, vAngleDeg: -14.79, pGenMw: 0, qGenMvar: 0, pLoadMw: 3.5, qLoadMvar: 1.8, qLimitHit: "none" },
  { busId: 12, name: "Bus 12", type: "PQ", vMagPu: 1.0552, vAngleDeg: -15.07, pGenMw: 0, qGenMvar: 0, pLoadMw: 6.1, qLoadMvar: 1.6, qLimitHit: "none" },
  { busId: 13, name: "Bus 13", type: "PQ", vMagPu: 1.0504, vAngleDeg: -15.16, pGenMw: 0, qGenMvar: 0, pLoadMw: 13.5, qLoadMvar: 5.8, qLimitHit: "none" },
  { busId: 14, name: "Bus 14", type: "PQ", vMagPu: 1.0355, vAngleDeg: -16.04, pGenMw: 0, qGenMvar: 0, pLoadMw: 14.9, qLoadMvar: 5, qLimitHit: "none" },
];

const IEEE14_BRANCHES: [number, number, number, number][] = [
  [1, 2, 156.88, -20.4],
  [1, 5, 75.51, 3.85],
  [2, 3, 73.24, 3.56],
  [2, 4, 56.13, -1.55],
  [2, 5, 41.52, 1.17],
  [3, 4, -23.29, 4.47],
  [4, 5, -61.16, 15.82],
  [4, 7, 28.07, -9.68],
  [4, 9, 16.08, -0.43],
  [5, 6, 44.09, 12.47],
  [6, 11, 7.35, 3.56],
  [6, 12, 7.79, 2.5],
  [6, 13, 17.75, 7.22],
  [7, 8, 0, -17.16],
  [7, 9, 28.07, 5.78],
  [9, 10, 5.23, 4.22],
  [9, 14, 9.43, 3.61],
  [10, 11, -3.79, -1.61],
  [12, 13, 1.61, 0.75],
  [13, 14, 5.64, 1.75],
];

function synthesizeBuses(caseId: string, seed: number): BusRow[] {
  const descriptor = findCase(caseId);
  const count = descriptor?.buses ?? 14;
  const generators = descriptor?.generators ?? Math.max(1, Math.round(count / 5));
  const random = mulberry32(seed);
  const rows: BusRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const isRef = index === 0;
    const isPv = !isRef && index < generators;
    const vMag = isRef ? 1.06 : isPv ? 1.02 + 0.03 * random() : 1.06 - 0.06 * random() - 0.004 * index;
    const angle = isRef ? 0 : -2 - 14 * random() - index * 0.02;
    const pLoad = isRef ? 0 : round(Math.max(0, 12 + 40 * random()), 2);
    const qLoad = round(pLoad * (0.2 + 0.25 * random()), 2);
    rows.push({
      busId: index + 1,
      name: `Bus ${String(index + 1).padStart(2, "0")}`,
      type: isRef ? "REF" : isPv ? "PV" : "PQ",
      vMagPu: round(Math.min(1.09, Math.max(0.93, vMag)), 4),
      vAngleDeg: round(angle, 2),
      pGenMw: isRef ? round(120 + 180 * random(), 2) : isPv ? round(40 + 90 * random(), 2) : 0,
      qGenMvar: isRef || isPv ? round(-20 + 60 * random(), 2) : 0,
      pLoadMw: pLoad,
      qLoadMvar: qLoad,
      qLimitHit: isPv && random() > 0.85 ? "max" : "none",
    });
  }
  return rows;
}

function branchesFor(caseId: string, buses: BusRow[], seed: number): BranchRow[] {
  if (caseId === "ieee14" || caseId === "matpower14") {
    return IEEE14_BRANCHES.map(([from, to, p, q], index) => {
      const lossP = round(Math.abs(p) * 0.012 + 0.05, 3);
      const lossQ = round(Math.abs(q) * 0.06 + 0.12, 3);
      return {
        branchId: index + 1,
        fromBus: from,
        toBus: to,
        pFromMw: p,
        qFromMvar: q,
        pToMw: round(-p + lossP, 3),
        qToMvar: round(-q + lossQ, 3),
        pLossMw: lossP,
        qLossMvar: lossQ,
        loadingPct: round(Math.min(112, (Math.hypot(p, q) / 160) * 100), 1),
      };
    });
  }
  const random = mulberry32(seed + 17);
  const rows: BranchRow[] = [];
  const count = findCase(caseId)?.branches ?? Math.max(1, buses.length - 1);
  for (let index = 0; index < count; index += 1) {
    const from = (index % buses.length) + 1;
    const to = ((index + 1 + Math.floor(random() * 2)) % buses.length) + 1;
    const p = round(-60 + 160 * random(), 3);
    const q = round(-25 + 50 * random(), 3);
    const lossP = round(Math.abs(p) * 0.011 + 0.03, 3);
    const lossQ = round(Math.abs(q) * 0.05 + 0.09, 3);
    rows.push({
      branchId: index + 1,
      fromBus: from,
      toBus: to === from ? (to % buses.length) + 1 : to,
      pFromMw: p,
      qFromMvar: q,
      pToMw: round(-p + lossP, 3),
      qToMvar: round(-q + lossQ, 3),
      pLossMw: lossP,
      qLossMvar: lossQ,
      loadingPct: round(Math.min(118, (Math.hypot(p, q) / 150) * 100), 1),
    });
  }
  return rows;
}

/** Mismatch trajectory characteristic of each solver family. */
export function mismatchHistory(method: PfOptions["pf_method"], tolerance: number, seed: number): number[] {
  const random = mulberry32(seed + 5);
  const history: number[] = [];
  if (method === "newton_raphson") {
    let value = 0.24;
    while (value > tolerance && history.length < 12) {
      history.push(value);
      value = value ** 2 * (1.4 + 0.3 * random());
    }
  } else if (method === "gauss_seidel") {
    let value = 0.31;
    while (value > tolerance && history.length < 260) {
      history.push(value);
      value *= 0.88 + 0.04 * random();
    }
  } else if (method === "bfs") {
    let value = 0.18;
    while (value > tolerance && history.length < 60) {
      history.push(value);
      value *= 0.34 + 0.06 * random();
    }
  } else {
    let value = 0.27;
    while (value > tolerance && history.length < 60) {
      history.push(value);
      value *= 0.42 + 0.08 * random();
    }
  }
  history.push(tolerance * (0.2 + 0.4 * random()));
  return history.map((item) => Number(item.toPrecision(6)));
}

const PF_SIGNALS: SignalDescriptor[] = [
  { id: "residual", label: "Max power mismatch", group: "Convergence", unit: "pu", panel: "residual" },
  { id: "v_min", label: "Minimum bus voltage", group: "Convergence", unit: "pu", panel: "voltage" },
  { id: "v_max", label: "Maximum bus voltage", group: "Convergence", unit: "pu", panel: "voltage" },
  { id: "angle_spread", label: "Angle spread", group: "Convergence", unit: "deg", panel: "angle" },
];

export function buildPfTruth(config: AnalysisConfig, seed: number): MockTruth {
  if (config.analysis !== "pf") throw new Error("buildPfTruth requires a pf config");
  const options = config.options;
  const descriptor = findCase(config.case);
  const buses =
    config.case === "ieee14" || config.case === "matpower14"
      ? IEEE14_BUSES
      : synthesizeBuses(config.case, seed);
  const branches = branchesFor(config.case, buses, seed);
  const history = mismatchHistory(options.pf_method, options.tolerance, seed);
  const random = mulberry32(seed + 31);
  const diverges = options.max_iter < history.length;

  const time = history.map((_, index) => index + 1);
  const vMinFinal = Math.min(...buses.map((bus) => bus.vMagPu));
  const vMaxFinal = Math.max(...buses.map((bus) => bus.vMagPu));
  const spreadFinal = Math.max(...buses.map((bus) => bus.vAngleDeg)) - Math.min(...buses.map((bus) => bus.vAngleDeg));

  const values: Record<string, number[]> = {
    residual: history,
    v_min: history.map((_, index) => round(vMinFinal - 0.05 * Math.exp(-index / 1.6) - 0.004 * gaussian(random), 5)),
    v_max: history.map((_, index) => round(vMaxFinal + 0.03 * Math.exp(-index / 1.4), 5)),
    angle_spread: history.map((_, index) => round(spreadFinal * (1 - 0.35 * Math.exp(-index / 1.5)), 4)),
  };

  const pLoss = round(branches.reduce((sum, row) => sum + row.pLossMw, 0), 3);
  const qLoss = round(branches.reduce((sum, row) => sum + row.qLossMvar, 0), 3);
  const pGen = round(buses.reduce((sum, row) => sum + row.pGenMw, 0), 3);
  const qGen = round(buses.reduce((sum, row) => sum + row.qGenMvar, 0), 3);
  const pLoad = round(buses.reduce((sum, row) => sum + row.pLoadMw, 0), 3);
  const qLoad = round(buses.reduce((sum, row) => sum + row.qLoadMvar, 0), 3);

  const qLimitEvents: QLimitEventRow[] = buses
    .filter((bus) => bus.qLimitHit !== "none")
    .map((bus, index) => ({
      round: index + 1,
      busId: bus.busId,
      fromType: "PV",
      toType: "PQ",
      qBeforeMvar: round(bus.qGenMvar + 6.2, 3),
      qFixedMvar: bus.qGenMvar,
      limitType: bus.qLimitHit === "max" ? "q_max" : "q_min",
    }));

  const warnings: string[] = [];
  if (qLimitEvents.length > 0) {
    warnings.push(
      `${qLimitEvents.length} PV bus${qLimitEvents.length > 1 ? "es" : ""} switched to PQ on a reactive limit.`,
    );
  }
  if (vMinFinal < 0.95) warnings.push(`Minimum voltage ${vMinFinal.toFixed(4)} pu is below the 0.95 pu planning band.`);
  const overloaded = branches.filter((row) => row.loadingPct > 100);
  if (overloaded.length > 0) warnings.push(`${overloaded.length} branch(es) above 100 % rating.`);

  return {
    time,
    axisLabel: "Iteration",
    axisUnit: "",
    signals: PF_SIGNALS,
    values,
    events: qLimitEvents.map((event, index) => ({
      id: `qlim-${index}`,
      kind: "limit" as const,
      t: event.round,
      label: `Bus ${event.busId} PV → PQ`,
      detail: `Reactive ${event.limitType} enforced at ${event.qFixedMvar.toFixed(2)} Mvar`,
      device: `Bus ${event.busId}`,
      severity: "warning" as const,
    })),
    logPlan: [
      { index: 0, level: "info", source: "loader", message: `Loaded case '${config.case}' (${descriptor?.buses ?? buses.length} buses, ${branches.length} branches).` },
      { index: 0, level: "debug", source: "ybus", message: "Y-bus assembled with shunts, off-nominal taps and phase shifters." },
      { index: 0, level: "info", source: "solver", message: `Starting ${PF_METHOD_LABELS[options.pf_method]} with tolerance ${options.tolerance.toExponential(2)}.` },
      ...history.map((value, index) => ({
        index,
        level: "debug" as const,
        source: "solver",
        message: `iter ${index + 1}: max mismatch ${value.toExponential(4)} pu`,
      })),
      ...(qLimitEvents.length > 0
        ? [{ index: Math.max(0, Math.floor(history.length / 2)), level: "warn" as const, source: "qlimits", message: `PV→PQ switch on bus ${qLimitEvents[0]?.busId ?? 0}; re-solving.` }]
        : []),
      {
        index: history.length - 1,
        level: diverges ? "error" : "info",
        source: "solver",
        message: diverges
          ? `Iteration limit ${options.max_iter} reached with mismatch ${history[options.max_iter - 1]?.toExponential(3) ?? "n/a"} pu.`
          : `Converged in ${history.length} iterations (max mismatch ${history.at(-1)?.toExponential(3)} pu).`,
      },
    ],
    stages: [
      { fromFraction: 0, label: "Loading case" },
      { fromFraction: 0.12, label: "Assembling Y-bus" },
      { fromFraction: 0.25, label: "Iterating" },
      { fromFraction: 0.9, label: "Post-processing flows" },
    ],
    targetDurationMs: 5200 + Math.round(2200 * random()),
    outcome: diverges ? "failed" : "converged",
    ...(diverges
      ? {
          failureReason: `max_iter (${options.max_iter}) reached before tolerance`,
          failureCode: "not_converged",
        }
      : {}),
    warnings,
    buildResult: (status, revealed): PfResult => {
      const converged = status === "converged" && !diverges;
      const iterations = Math.max(1, Math.min(revealed, history.length));
      return {
        kind: "pf",
        systemName: descriptor?.name ?? config.case,
        method: options.pf_method,
        converged,
        reason: converged ? "tolerance_met" : (diverges ? "max_iter_reached" : status),
        finiteStatus: "all_finite",
        iterations,
        maxMismatch: history[iterations - 1] ?? options.tolerance,
        mismatchHistory: history.slice(0, iterations),
        pLossTotalMw: pLoss,
        qLossTotalMvar: qLoss,
        pTotalGenMw: pGen,
        qTotalGenMvar: qGen,
        pTotalLoadMw: pLoad,
        qTotalLoadMvar: qLoad,
        buses,
        branches,
        qLimitEvents,
      };
    },
  };
}
