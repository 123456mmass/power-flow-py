/**
 * Static catalogue metadata used to drive context-sensitive forms.
 *
 * Case identifiers, analysis ids, solver names, model names, IBR products and
 * option defaults follow the active surface of the Python package. Bus/branch
 * counts and provenance strings are mock display metadata (see README
 * assumptions) and are replaced by `GET /api/cases` from a live backend.
 */

import type {
  AnalysisKind,
  CaseDescriptor,
  DynamicModel,
  IbrOptions,
  IbrProduct,
  Integrator,
  PfMethod,
  PfOptions,
  SssaOptions,
  TsOptions,
} from "./types";

export const ANALYSIS_LABELS: Record<AnalysisKind, string> = {
  pf: "Power flow",
  sssa: "Small-signal stability",
  ts: "Time-domain simulation",
  ibr: "IBR study",
};

export const ANALYSIS_SHORT: Record<AnalysisKind, string> = {
  pf: "PF",
  sssa: "SSSA",
  ts: "TDS",
  ibr: "IBR",
};

export const ANALYSIS_DESCRIPTIONS: Record<AnalysisKind, string> = {
  pf: "AC power flow with PV reactive-limit switching.",
  sssa: "Linearised eigenvalue analysis with damping classification.",
  ts: "Fixed-step nonlinear time-domain simulation with fault events.",
  ibr: "Grid-following / grid-forming inverter studies with AGSI++ switching.",
};

export const PF_METHOD_LABELS: Record<PfMethod, string> = {
  newton_raphson: "Newton-Raphson",
  gauss_seidel: "Gauss-Seidel",
  fdpf_xb: "FDPF-XB",
  fdpf_bx: "FDPF-BX",
  bfs: "Backward/forward sweep (radial)",
};

export const MODEL_LABELS: Record<DynamicModel, string> = {
  classical: "Classical multimachine",
  emf6: "Sixth-order EMF (EMF6)",
  padiyar_1_1_avr: "Padiyar model-1.1 with AVR",
  padiyar_1_1_manual: "Padiyar model-1.1 manual excitation",
};

export const INTEGRATOR_LABELS: Record<Integrator, string> = {
  trapezoidal: "Trapezoidal (implicit)",
  rk4: "Runge-Kutta 4 (diagnostic)",
  backward_euler: "Backward Euler",
};

export const IBR_PRODUCT_LABELS: Record<IbrProduct, string> = {
  pf: "PF equilibrium",
  sssa: "Schur small-signal",
  ts: "Time-domain",
  full: "Full (PF + SSSA + TDS)",
  sssa_load_sweep: "SSSA load sweep",
};

/** Per-method iteration defaults, matching `PowerFlowOptions.from_mapping`. */
export const PF_MAX_ITER_DEFAULTS: Record<PfMethod, number> = {
  newton_raphson: 20,
  gauss_seidel: 200,
  fdpf_xb: 50,
  fdpf_bx: 50,
  bfs: 100,
};

function pfCase(
  id: string,
  name: string,
  buses: number,
  branches: number,
  generators: number,
  provenance: string,
  extra: Partial<CaseDescriptor> = {},
): CaseDescriptor {
  return {
    id,
    name,
    buses,
    branches,
    generators,
    ibrDevices: 0,
    radial: false,
    analyses: ["pf", "sssa", "ts"],
    provenance,
    readiness: "production",
    ...extra,
  };
}

export const CASES: CaseDescriptor[] = [
  pfCase("ieee5", "IEEE 5-bus", 5, 7, 2, "IEEE textbook baseline"),
  pfCase("case9", "WSCC 9-bus", 9, 9, 3, "Anderson & Fouad"),
  pfCase("ieee14", "IEEE 14-bus", 14, 20, 5, "IEEE common data format"),
  pfCase("matpower14", "IEEE 14-bus (MATPOWER data)", 14, 20, 5, "MATPOWER-provenance static data"),
  pfCase("rts24", "IEEE RTS 24-bus", 24, 38, 11, "IEEE Reliability Test System"),
  pfCase("ieee30", "IEEE 30-bus", 30, 41, 6, "IEEE common data format"),
  pfCase("matpower30", "IEEE 30-bus (MATPOWER data)", 30, 41, 6, "MATPOWER-provenance static data"),
  pfCase("saadat67", "Saadat example 6.7", 6, 7, 2, "Saadat, Power System Analysis"),
  pfCase("saadat68", "Saadat example 6.8", 6, 7, 2, "Saadat, Power System Analysis"),
  pfCase("ieee300", "IEEE 300-bus", 300, 411, 69, "IEEE large-system benchmark"),
  pfCase("kundur", "Kundur two-area (default route)", 11, 12, 4, "Kundur, Power System Stability", {
    defaultModel: "emf6",
  }),
  pfCase("kundur_two_area", "Kundur two-area (classical data)", 11, 12, 4, "Kundur, Power System Stability"),
  pfCase("padiyar_two_area", "Padiyar two-area", 10, 12, 4, "Padiyar, Power System Dynamics", {
    defaultModel: "padiyar_1_1_avr",
  }),
  pfCase("template", "3-bus template", 3, 3, 1, "Contract template case", {
    radial: true,
  }),
];

function ibrCase(
  id: string,
  name: string,
  buses: number,
  devices: number,
  provenance: string,
  readiness: CaseDescriptor["readiness"] = "diagnostic",
): CaseDescriptor {
  return {
    id,
    name,
    buses,
    branches: Math.max(1, buses - 1),
    generators: id.includes("ieee14") || id.includes("padiyar") ? 1 : 0,
    ibrDevices: devices,
    radial: buses <= 2,
    analyses: ["ibr"],
    provenance,
    readiness,
  };
}

export const IBR_CASES: CaseDescriptor[] = [
  ibrCase("gfl_reduced6_smib", "GFL reduced-six SMIB", 2, 1, "Reduced six-state GFL SMIB"),
  ibrCase("gfm_reduced6_smib", "GFM reduced-six SMIB", 2, 1, "Reduced six-state GFM SMIB"),
  ibrCase("gfl_rms10_smib", "GFL-RMS10 SMIB", 2, 1, "Ten-state GFL RMS SMIB"),
  ibrCase("gfm_no_pll_smib", "GFM-VSG no-PLL SMIB", 2, 1, "Four-state GFM-VSG"),
  ibrCase("gfm_vsm_sakimoto_smib", "GFM-VSM Sakimoto SMIB", 2, 1, "Nine-state Sakimoto VSM"),
  ibrCase("gfl_rms10_loaded_smib", "GFL-RMS10 loaded SMIB", 3, 1, "Loaded SMIB load sweep"),
  ibrCase("gfm_no_pll_loaded_smib", "GFM no-PLL loaded SMIB", 3, 1, "Loaded SMIB load sweep"),
  ibrCase("two_ibr_switch", "Two-device common PCC (AGSI++)", 3, 2, "Two-device AGSI++ switching"),
  ibrCase("ieee14_switch", "IEEE 14-bus 1 SG + 4 IBR (AGSI++)", 14, 4, "IEEE14 AGSI++ trip/reclose", "production"),
  ibrCase("padiyar_switch", "Padiyar two-area 1 SG + 3 IBR (AGSI++)", 10, 3, "Padiyar AGSI++ trip/reclose", "production"),
];

export const ALL_CASES: CaseDescriptor[] = [...CASES, ...IBR_CASES];

export function casesForAnalysis(analysis: AnalysisKind): CaseDescriptor[] {
  return ALL_CASES.filter((item) => item.analyses.includes(analysis));
}

export function findCase(id: string): CaseDescriptor | undefined {
  return ALL_CASES.find((item) => item.id === id);
}

/** Cases whose default detailed model differs from `classical`. */
export function defaultModelFor(analysis: AnalysisKind, caseId: string): DynamicModel {
  if (analysis !== "sssa" && analysis !== "ts") return "classical";
  return findCase(caseId)?.defaultModel ?? "classical";
}

/** Load-sweep products only exist for the loaded SMIB cases. */
export function ibrProductsFor(caseId: string): IbrProduct[] {
  if (caseId.includes("loaded")) return ["pf", "sssa", "sssa_load_sweep", "full"];
  if (caseId.endsWith("_switch")) return ["full", "ts"];
  return ["pf", "sssa", "ts", "full"];
}

/** BFS is only valid on radial PQ-only networks (fail-closed in the solver). */
export function pfMethodsFor(caseId: string): PfMethod[] {
  const base: PfMethod[] = ["newton_raphson", "gauss_seidel", "fdpf_xb", "fdpf_bx"];
  return findCase(caseId)?.radial === true ? [...base, "bfs"] : base;
}

export function modelsFor(caseId: string): DynamicModel[] {
  const descriptor = findCase(caseId);
  if (descriptor?.defaultModel === "emf6") return ["emf6", "classical"];
  if (descriptor?.defaultModel === "padiyar_1_1_avr") {
    return ["padiyar_1_1_avr", "padiyar_1_1_manual", "classical"];
  }
  return ["classical"];
}

export const DEFAULT_PF_OPTIONS: PfOptions = {
  pf_method: "newton_raphson",
  tolerance: 1e-6,
  max_iter: 20,
  enforce_q_limits: true,
  acceleration: 1.4,
  q_limit_tolerance: 1e-6,
  max_q_limit_switches: 20,
};

export const DEFAULT_SSSA_OPTIONS: SssaOptions = { model: "classical" };

export const DEFAULT_TS_OPTIONS: TsOptions = {
  model: "classical",
  integrator: "trapezoidal",
  t_end: 1,
  dt: 0.01,
  fault_bus: null,
  t_fault: 0.5,
  t_clear: 0.6,
};

export const DEFAULT_IBR_OPTIONS: IbrOptions = {
  ibr_analysis: "full",
  t_end: 0.05,
  dt: 0.001,
  fault_on: 0,
  fault_clear: 0,
  fault_reactance: 0.1,
  step_on: 0,
  step_dv: -0.1,
  step_dphase_deg: 20,
  sssa_load_percentages: [0, 20, 40, 60, 80],
};

export const DEFAULT_CASE: Record<AnalysisKind, string> = {
  pf: "ieee14",
  sssa: "rts24",
  ts: "kundur",
  ibr: "ieee14_switch",
};

/** Solver label shown in tables and breadcrumbs. */
export function solverLabel(analysis: AnalysisKind, options: unknown): string {
  if (analysis === "pf") {
    const method = (options as PfOptions).pf_method;
    return PF_METHOD_LABELS[method] ?? method;
  }
  if (analysis === "ts") {
    const integrator = (options as TsOptions).integrator;
    return INTEGRATOR_LABELS[integrator] ?? integrator;
  }
  if (analysis === "sssa") return "Eigen/Schur";
  return IBR_PRODUCT_LABELS[(options as IbrOptions).ibr_analysis] ?? "IBR";
}
