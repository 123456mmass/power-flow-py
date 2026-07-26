/**
 * Validation for analysis configuration.
 *
 * Ranges mirror the fail-closed guards in `power_flow.contracts`
 * (positive finite tolerance, `max_iter >= 1`, positive acceleration, ...) plus
 * practical UI bounds so that an obviously unusable job never reaches a worker.
 */

import { z } from "zod";

import {
  ANALYSIS_KINDS,
  DYNAMIC_MODELS,
  IBR_PRODUCTS,
  INTEGRATORS,
  PF_METHODS,
} from "./types";
import type { AnalysisConfig, AnalysisKind } from "./types";
import { findCase } from "./catalog";

const finite = (label: string) =>
  z.number({ error: `${label} must be a number` }).refine(Number.isFinite, {
    message: `${label} must be finite`,
  });

export const pfOptionsSchema = z.object({
  pf_method: z.enum(PF_METHODS),
  tolerance: finite("Tolerance").gt(0, "Tolerance must be greater than 0").lte(1e-1, "Tolerance must be ≤ 1e-1"),
  max_iter: z.number().int("Max iterations must be an integer").min(1, "Max iterations must be ≥ 1").max(5000, "Max iterations must be ≤ 5000"),
  enforce_q_limits: z.boolean(),
  acceleration: finite("Acceleration").gt(0, "Acceleration must be greater than 0").lte(2, "Acceleration must be ≤ 2"),
  q_limit_tolerance: finite("Q-limit tolerance").min(0, "Q-limit tolerance must be ≥ 0").lte(1, "Q-limit tolerance must be ≤ 1"),
  max_q_limit_switches: z.number().int().min(0, "Q-limit switches must be ≥ 0").max(500),
});

export const sssaOptionsSchema = z.object({
  model: z.enum(DYNAMIC_MODELS),
});

export const tsOptionsSchema = z
  .object({
    model: z.enum(DYNAMIC_MODELS),
    integrator: z.enum(INTEGRATORS),
    t_end: finite("End time").gt(0, "End time must be greater than 0").lte(60, "End time must be ≤ 60 s"),
    dt: finite("Time step").gt(0, "Time step must be greater than 0").lte(1, "Time step must be ≤ 1 s"),
    fault_bus: z.number().int().min(1).nullable(),
    t_fault: finite("Fault time").min(0, "Fault time must be ≥ 0"),
    t_clear: finite("Clearing time").min(0, "Clearing time must be ≥ 0"),
  })
  .check((ctx) => {
    const value = ctx.value;
    if (value.dt >= value.t_end) {
      ctx.issues.push({
        code: "custom",
        input: value.dt,
        path: ["dt"],
        message: "Time step must be smaller than the end time",
      });
    }
    if (value.t_end / value.dt > 400000) {
      ctx.issues.push({
        code: "custom",
        input: value.dt,
        path: ["dt"],
        message: "Step count exceeds 400 000; increase dt or reduce end time",
      });
    }
    if (value.fault_bus !== null) {
      if (value.t_clear < value.t_fault) {
        ctx.issues.push({
          code: "custom",
          input: value.t_clear,
          path: ["t_clear"],
          message: "Clearing time must be ≥ fault time",
        });
      }
      if (value.t_fault > value.t_end) {
        ctx.issues.push({
          code: "custom",
          input: value.t_fault,
          path: ["t_fault"],
          message: "Fault time must be within the simulation window",
        });
      }
    }
  });

export const ibrOptionsSchema = z
  .object({
    ibr_analysis: z.enum(IBR_PRODUCTS),
    t_end: finite("End time").gt(0, "End time must be greater than 0").lte(30, "End time must be ≤ 30 s"),
    dt: finite("Time step").gt(0, "Time step must be greater than 0").lte(0.05, "IBR time step must be ≤ 50 ms"),
    fault_on: finite("Fault on").min(0, "Fault on must be ≥ 0"),
    fault_clear: finite("Fault clear").min(0, "Fault clear must be ≥ 0"),
    fault_reactance: finite("Fault reactance").gt(0, "Fault reactance must be greater than 0").lte(5),
    step_on: finite("Step time").min(0, "Step time must be ≥ 0"),
    step_dv: finite("Voltage step").gte(-0.9, "Voltage step must be ≥ -0.9 pu").lte(0.9, "Voltage step must be ≤ 0.9 pu"),
    step_dphase_deg: finite("Phase step").gte(-180).lte(180),
    sssa_load_percentages: z
      .array(finite("Load percentage").min(0).max(200))
      .min(1, "Provide at least one load percentage")
      .max(20, "At most 20 load percentages"),
  })
  .check((ctx) => {
    const value = ctx.value;
    if (value.dt >= value.t_end) {
      ctx.issues.push({
        code: "custom",
        input: value.dt,
        path: ["dt"],
        message: "Time step must be smaller than the end time",
      });
    }
    if (value.fault_clear > 0 && value.fault_clear < value.fault_on) {
      ctx.issues.push({
        code: "custom",
        input: value.fault_clear,
        path: ["fault_clear"],
        message: "Fault clearing must be ≥ fault application",
      });
    }
  });

export const analysisConfigSchema = z
  .discriminatedUnion("analysis", [
    z.object({ analysis: z.literal("pf"), case: z.string().min(1), options: pfOptionsSchema }),
    z.object({ analysis: z.literal("sssa"), case: z.string().min(1), options: sssaOptionsSchema }),
    z.object({ analysis: z.literal("ts"), case: z.string().min(1), options: tsOptionsSchema }),
    z.object({ analysis: z.literal("ibr"), case: z.string().min(1), options: ibrOptionsSchema }),
  ])
  .check((ctx) => {
    const value = ctx.value;
    const descriptor = findCase(value.case);
    if (!descriptor) {
      ctx.issues.push({
        code: "custom",
        input: value.case,
        path: ["case"],
        message: `Unknown case '${value.case}'`,
      });
      return;
    }
    if (!descriptor.analyses.includes(value.analysis as AnalysisKind)) {
      ctx.issues.push({
        code: "custom",
        input: value.case,
        path: ["case"],
        message: `Case '${descriptor.id}' does not expose the ${value.analysis} analysis`,
      });
    }
    if (value.analysis === "pf" && value.options.pf_method === "bfs" && !descriptor.radial) {
      ctx.issues.push({
        code: "custom",
        input: value.options.pf_method,
        path: ["options", "pf_method"],
        message: "Backward/forward sweep requires a radial PQ-only network",
      });
    }
  });

export const runRequestSchema = z.object({
  config: analysisConfigSchema,
  label: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

export type FieldErrors = Record<string, string>;

/** Flattens zod issues into `dotted.path -> message` for form rendering. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function validateConfig(
  config: unknown,
): { ok: true; value: AnalysisConfig } | { ok: false; errors: FieldErrors } {
  const parsed = analysisConfigSchema.safeParse(config);
  if (parsed.success) return { ok: true, value: parsed.data as AnalysisConfig };
  return { ok: false, errors: fieldErrors(parsed.error) };
}

export const ANALYSIS_ENUM = z.enum(ANALYSIS_KINDS);
