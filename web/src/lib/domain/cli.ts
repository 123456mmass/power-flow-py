import type { AnalysisConfig } from "./types";

/**
 * Renders the `power-flow` CLI invocation equivalent to a UI configuration.
 *
 * This keeps a study reproducible outside the console: the same option names
 * are accepted by `power_flow.api.solve_case`.
 */
export function toCliCommand(config: AnalysisConfig): string {
  const parts = ["power-flow", `--analysis ${config.analysis}`, `--case ${config.case}`];
  if (config.analysis === "pf") {
    const options = config.options;
    parts.push(`--method ${options.pf_method}`);
    parts.push(`--tolerance ${options.tolerance}`);
    parts.push(`--max-iter ${options.max_iter}`);
    if (options.pf_method === "gauss_seidel") parts.push(`--acceleration ${options.acceleration}`);
    if (!options.enforce_q_limits) parts.push("--no-q-limits");
  } else if (config.analysis === "sssa") {
    parts.push(`--model ${config.options.model}`);
  } else if (config.analysis === "ts") {
    const options = config.options;
    parts.push(`--model ${options.model}`);
    parts.push(`--integrator ${options.integrator}`);
    parts.push(`--t-end ${options.t_end}`);
    parts.push(`--dt ${options.dt}`);
    if (options.fault_bus !== null) {
      parts.push(`--fault-bus ${options.fault_bus}`);
      parts.push(`--t-fault ${options.t_fault}`);
      parts.push(`--t-clear ${options.t_clear}`);
    }
  } else {
    const options = config.options;
    parts.push(`--ibr-product ${options.ibr_analysis}`);
    if (options.ibr_analysis !== "pf" && options.ibr_analysis !== "sssa") {
      parts.push(`--t-end ${options.t_end}`);
      parts.push(`--dt ${options.dt}`);
    }
    if (options.ibr_analysis === "sssa_load_sweep") {
      parts.push(`--ibr-load-percentages ${options.sssa_load_percentages.join(" ")}`);
    }
    if (options.fault_clear > options.fault_on && options.fault_clear > 0) {
      parts.push(`--ibr-fault-on ${options.fault_on}`);
      parts.push(`--ibr-fault-clear ${options.fault_clear}`);
      parts.push(`--ibr-fault-reactance ${options.fault_reactance}`);
    }
    if (options.step_on > 0) {
      parts.push(`--ibr-step-on ${options.step_on}`);
      parts.push(`--ibr-step-dv ${options.step_dv}`);
      parts.push(`--ibr-step-dphase-deg ${options.step_dphase_deg}`);
    }
  }
  return parts.join(" ");
}

/** Estimated step count for time-domain analyses; used for UI guidance only. */
export function estimatedSteps(config: AnalysisConfig): number | null {
  if (config.analysis === "ts" || config.analysis === "ibr") {
    const { t_end: tEnd, dt } = config.options;
    if (!Number.isFinite(tEnd) || !Number.isFinite(dt) || dt <= 0) return null;
    if (config.analysis === "ibr" && (config.options.ibr_analysis === "pf" || config.options.ibr_analysis === "sssa")) {
      return null;
    }
    return Math.round(tEnd / dt);
  }
  return null;
}
