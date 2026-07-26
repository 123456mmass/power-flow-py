import { describe, expect, it } from "vitest";

import { DEFAULT_IBR_OPTIONS, DEFAULT_PF_OPTIONS, DEFAULT_TS_OPTIONS } from "@/lib/domain/catalog";
import { validateConfig } from "@/lib/domain/config-schema";
import type { AnalysisConfig } from "@/lib/domain/types";

const pf = (overrides: Partial<typeof DEFAULT_PF_OPTIONS> = {}): AnalysisConfig => ({
  analysis: "pf",
  case: "ieee14",
  options: { ...DEFAULT_PF_OPTIONS, ...overrides },
});

const ts = (overrides: Partial<typeof DEFAULT_TS_OPTIONS> = {}): AnalysisConfig => ({
  analysis: "ts",
  case: "kundur",
  options: { ...DEFAULT_TS_OPTIONS, model: "emf6", ...overrides },
});

const ibr = (overrides: Partial<typeof DEFAULT_IBR_OPTIONS> = {}): AnalysisConfig => ({
  analysis: "ibr",
  case: "ieee14_switch",
  options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "full", t_end: 6, dt: 0.002, ...overrides },
});

describe("analysis configuration validation", () => {
  it("accepts the audited power-flow defaults", () => {
    const result = validateConfig(pf());
    expect(result.ok).toBe(true);
  });

  it("rejects a non-positive tolerance", () => {
    const result = validateConfig(pf({ tolerance: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.tolerance"]).toMatch(/greater than 0/i);
  });

  it("rejects a non-finite tolerance", () => {
    const result = validateConfig(pf({ tolerance: Number.NaN }));
    expect(result.ok).toBe(false);
  });

  it("requires at least one iteration", () => {
    const result = validateConfig(pf({ max_iter: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.max_iter"]).toMatch(/at least|≥ 1/i);
  });

  it("fails closed on backward/forward sweep for a meshed network", () => {
    const result = validateConfig(pf({ pf_method: "bfs" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.pf_method"]).toMatch(/radial/i);
  });

  it("allows backward/forward sweep on the radial template case", () => {
    const result = validateConfig({ ...pf({ pf_method: "bfs" }), case: "template" } as AnalysisConfig);
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown case id", () => {
    const result = validateConfig({ ...pf(), case: "not_a_case" } as AnalysisConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["case"]).toMatch(/unknown case/i);
  });

  it("rejects an analysis the case does not expose", () => {
    const result = validateConfig({ ...pf(), case: "ieee14_switch" } as AnalysisConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["case"]).toMatch(/does not expose/i);
  });

  it("requires the time step to be smaller than the end time", () => {
    const result = validateConfig(ts({ t_end: 0.01, dt: 0.01 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.dt"]).toMatch(/smaller than the end time/i);
  });

  it("requires clearing time after fault time when a fault bus is set", () => {
    const result = validateConfig(ts({ fault_bus: 7, t_fault: 0.6, t_clear: 0.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.t_clear"]).toMatch(/≥ fault time/i);
  });

  it("ignores fault ordering when no fault bus is configured", () => {
    const result = validateConfig(ts({ fault_bus: null, t_fault: 0.6, t_clear: 0.5 }));
    expect(result.ok).toBe(true);
  });

  it("caps the step count to protect the worker", () => {
    const result = validateConfig(ts({ t_end: 50, dt: 1e-5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.dt"]).toMatch(/step count/i);
  });

  it("accepts an IEEE14 AGSI++ switching configuration", () => {
    expect(validateConfig(ibr()).ok).toBe(true);
  });

  it("bounds the IBR time step", () => {
    const result = validateConfig(ibr({ dt: 0.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.dt"]).toMatch(/50 ms/i);
  });

  it("requires at least one load-sweep point", () => {
    const result = validateConfig({
      analysis: "ibr",
      case: "gfl_rms10_loaded_smib",
      options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "sssa_load_sweep", sssa_load_percentages: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["options.sssa_load_percentages"]).toMatch(/at least one/i);
  });
});
