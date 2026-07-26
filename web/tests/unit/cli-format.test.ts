import { describe, expect, it } from "vitest";

import { DEFAULT_IBR_OPTIONS, DEFAULT_PF_OPTIONS, DEFAULT_TS_OPTIONS } from "@/lib/domain/catalog";
import { estimatedSteps, toCliCommand } from "@/lib/domain/cli";
import { formatDuration, formatExp, formatNumber, toCsv } from "@/lib/utils/format";

describe("CLI equivalence", () => {
  it("renders a power-flow command with method and tolerance", () => {
    const command = toCliCommand({
      analysis: "pf",
      case: "ieee14",
      options: { ...DEFAULT_PF_OPTIONS, pf_method: "fdpf_xb", tolerance: 1e-10, max_iter: 50 },
    });
    expect(command).toBe("power-flow --analysis pf --case ieee14 --method fdpf_xb --tolerance 1e-10 --max-iter 50");
  });

  it("adds the acceleration flag only for Gauss-Seidel", () => {
    const gs = toCliCommand({
      analysis: "pf",
      case: "ieee14",
      options: { ...DEFAULT_PF_OPTIONS, pf_method: "gauss_seidel" },
    });
    expect(gs).toContain("--acceleration 1.4");
    const nr = toCliCommand({ analysis: "pf", case: "ieee14", options: DEFAULT_PF_OPTIONS });
    expect(nr).not.toContain("--acceleration");
  });

  it("emits fault flags only when a fault bus is set", () => {
    const withFault = toCliCommand({
      analysis: "ts",
      case: "kundur",
      options: { ...DEFAULT_TS_OPTIONS, model: "emf6", fault_bus: 7, t_fault: 0.5, t_clear: 0.58 },
    });
    expect(withFault).toContain("--fault-bus 7");
    expect(withFault).toContain("--t-clear 0.58");

    const withoutFault = toCliCommand({
      analysis: "ts",
      case: "kundur",
      options: { ...DEFAULT_TS_OPTIONS, model: "emf6", fault_bus: null },
    });
    expect(withoutFault).not.toContain("--fault-bus");
  });

  it("renders the IBR load sweep points", () => {
    const command = toCliCommand({
      analysis: "ibr",
      case: "gfl_rms10_loaded_smib",
      options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "sssa_load_sweep", sssa_load_percentages: [0, 20, 40] },
    });
    expect(command).toContain("--ibr-product sssa_load_sweep");
    expect(command).toContain("--ibr-load-percentages 0 20 40");
  });

  it("estimates integration steps for time-domain configurations only", () => {
    expect(
      estimatedSteps({ analysis: "ts", case: "kundur", options: { ...DEFAULT_TS_OPTIONS, t_end: 2, dt: 0.005 } }),
    ).toBe(400);
    expect(estimatedSteps({ analysis: "pf", case: "ieee14", options: DEFAULT_PF_OPTIONS })).toBeNull();
    expect(
      estimatedSteps({
        analysis: "ibr",
        case: "gfm_no_pll_smib",
        options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "sssa" },
      }),
    ).toBeNull();
  });
});

describe("formatting helpers", () => {
  it("formats durations across magnitudes", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(125_000)).toBe("2m 05s");
    expect(formatDuration(null)).toBe("—");
  });

  it("switches to exponential notation for very small numbers", () => {
    expect(formatNumber(1.23456, 3)).toBe("1.235");
    expect(formatNumber(2.4e-11, 3)).toBe("2.400e-11");
    expect(formatExp(2.4e-11, 2)).toBe("2.40e-11");
  });

  it("escapes CSV fields per RFC 4180", () => {
    const csv = toCsv(["bus", "note"], [[1, 'says "hi", loudly'], [2, "plain"]]);
    expect(csv.split("\r\n")[1]).toBe('1,"says ""hi"", loudly"');
  });
});
