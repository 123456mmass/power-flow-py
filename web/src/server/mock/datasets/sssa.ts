import type { AnalysisConfig, EigenMode, SignalDescriptor, SssaResult } from "@/lib/domain/types";
import { findCase, MODEL_LABELS } from "@/lib/domain/catalog";

import { mulberry32, round } from "../rng";
import type { MockTruth } from "../truth";

const STATE_NAMES: Record<string, string[]> = {
  classical: ["δ", "ω"],
  emf6: ["δ", "ω", "E'q", "E'd", "E''q", "E''d"],
  padiyar_1_1_avr: ["δ", "ω", "E'q", "Efd", "Vr"],
  padiyar_1_1_manual: ["δ", "ω", "E'q", "ψ"],
};

function statesPerMachine(model: string): number {
  return STATE_NAMES[model]?.length ?? 2;
}

function classify(dampingRatio: number): EigenMode["classification"] {
  if (dampingRatio < 0) return "unstable";
  if (dampingRatio < 0.03) return "marginal";
  return "stable";
}

export function buildEigenModes(caseId: string, model: string, seed: number): EigenMode[] {
  const descriptor = findCase(caseId);
  const machines = Math.max(2, descriptor?.generators ?? 4);
  const random = mulberry32(seed + 97);
  const stateNames = STATE_NAMES[model] ?? STATE_NAMES.classical!;
  const total = machines * statesPerMachine(model);
  const modes: EigenMode[] = [];

  // One inter-area mode plus one local mode per remaining machine.
  const oscillatory = Math.max(1, Math.floor(total / 2) - 1);
  for (let index = 0; index < oscillatory; index += 1) {
    const interArea = index === 0;
    const frequency = interArea ? 0.42 + 0.18 * random() : 0.9 + 1.35 * random();
    const damping = interArea
      ? (caseId.startsWith("kundur") ? -0.012 + 0.05 * random() : 0.015 + 0.05 * random())
      : 0.045 + 0.12 * random();
    const omega = 2 * Math.PI * frequency;
    const sigma = -damping * omega / Math.sqrt(Math.max(1e-6, 1 - damping ** 2));
    modes.push({
      index: modes.length + 1,
      real: round(sigma, 5),
      imag: round(omega, 5),
      frequencyHz: round(frequency, 4),
      dampingRatio: round(damping, 5),
      timeConstantS: sigma < 0 ? round(-1 / sigma, 4) : null,
      classification: classify(damping),
      dominantState: `${stateNames[index % stateNames.length]}${(index % machines) + 1}`,
      participation: round(0.35 + 0.6 * random(), 4),
    });
  }

  // Real (non-oscillatory) modes: excitation and governor time constants.
  const realCount = Math.max(1, total - oscillatory * 2);
  for (let index = 0; index < realCount; index += 1) {
    const sigma = -(0.25 + 8 * random());
    modes.push({
      index: modes.length + 1,
      real: round(sigma, 5),
      imag: 0,
      frequencyHz: 0,
      dampingRatio: 1,
      timeConstantS: round(-1 / sigma, 4),
      classification: "stable",
      dominantState: `${stateNames[(index + 2) % stateNames.length]}${(index % machines) + 1}`,
      participation: round(0.2 + 0.5 * random(), 4),
    });
  }

  return modes;
}

const SSSA_SIGNALS: SignalDescriptor[] = [
  { id: "residual", label: "Equilibrium residual", group: "Convergence", unit: "pu", panel: "residual" },
  { id: "min_damping", label: "Minimum damping ratio", group: "Modes", unit: "-", panel: "mode" },
  { id: "spectral_radius", label: "Max real part", group: "Modes", unit: "1/s", panel: "mode" },
];

export function buildSssaTruth(config: AnalysisConfig, seed: number): MockTruth {
  if (config.analysis !== "sssa") throw new Error("buildSssaTruth requires an sssa config");
  const descriptor = findCase(config.case);
  const model = config.options.model;
  const modes = buildEigenModes(config.case, model, seed);
  const random = mulberry32(seed + 11);

  const oscillatory = modes.filter((mode) => mode.imag > 0);
  const minDamping = Math.min(...oscillatory.map((mode) => mode.dampingRatio));
  const criticalIndex = oscillatory.find((mode) => mode.dampingRatio === minDamping)?.index ?? 1;
  const maxReal = Math.max(...modes.map((mode) => mode.real));
  const stable = maxReal < 0;

  const steps = 9 + Math.floor(4 * random());
  const time: number[] = [];
  const residual: number[] = [];
  const damping: number[] = [];
  const spectral: number[] = [];
  let value = 0.19;
  for (let index = 0; index < steps; index += 1) {
    time.push(index + 1);
    residual.push(Number(value.toPrecision(6)));
    value = value ** 1.9 * 1.3;
    const progress = (index + 1) / steps;
    damping.push(round(minDamping + (0.12 - minDamping) * (1 - progress) ** 2, 5));
    spectral.push(round(maxReal + (2.5 - maxReal) * (1 - progress) ** 3, 5));
  }

  const warnings: string[] = [];
  if (!stable) warnings.push(`Unstable eigenvalue detected: max real part ${maxReal.toFixed(4)} 1/s.`);
  if (minDamping < 0.05) {
    warnings.push(`Mode ${criticalIndex} damping ${(minDamping * 100).toFixed(2)} % is below the 5 % criterion.`);
  }

  return {
    time,
    axisLabel: "Solve step",
    axisUnit: "",
    signals: SSSA_SIGNALS,
    values: { residual, min_damping: damping, spectral_radius: spectral },
    events: [],
    logPlan: [
      { index: 0, level: "info", source: "loader", message: `Loaded case '${config.case}' for ${MODEL_LABELS[model]} SSSA.` },
      { index: 1, level: "info", source: "equilibrium", message: "Solving PF equilibrium before linearisation." },
      ...residual.map((item, index) => ({
        index,
        level: "debug" as const,
        source: "equilibrium",
        message: `equilibrium iter ${index + 1}: residual ${item.toExponential(3)} pu`,
      })),
      { index: Math.floor(steps * 0.6), level: "info", source: "linearise", message: `State matrix assembled: ${modes.length} states${model === "classical" ? " with COI reduction" : ""}.` },
      { index: Math.floor(steps * 0.8), level: "info", source: "eigen", message: `Eigen-decomposition complete: ${oscillatory.length} oscillatory modes.` },
      ...(stable
        ? []
        : [{ index: steps - 1, level: "warn" as const, source: "classify", message: "System classified UNSTABLE by right-half-plane eigenvalue." }]),
      {
        index: steps - 1,
        level: "info",
        source: "classify",
        message: `Minimum damping ratio ${(minDamping * 100).toFixed(2)} % on mode ${criticalIndex}.`,
      },
    ],
    stages: [
      { fromFraction: 0, label: "Loading case" },
      { fromFraction: 0.1, label: "PF equilibrium" },
      { fromFraction: 0.55, label: "Linearising" },
      { fromFraction: 0.78, label: "Eigen-decomposition" },
      { fromFraction: 0.93, label: "Classifying modes" },
    ],
    targetDurationMs: 7000 + Math.round(3000 * random()),
    outcome: "converged",
    warnings,
    buildResult: (): SssaResult => ({
      kind: "sssa",
      systemName: descriptor?.name ?? config.case,
      model,
      stable,
      classification: stable ? (minDamping < 0.05 ? "stable, poorly damped" : "stable") : "unstable",
      stateCount: modes.length,
      modes,
      minDampingRatio: round(minDamping, 5),
      criticalModeIndex: criticalIndex,
      coiReduction: model === "classical",
    }),
  };
}
