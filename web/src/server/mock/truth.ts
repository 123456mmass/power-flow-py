import type {
  AnalysisConfig,
  AnalysisResult,
  RunStatus,
  SignalDescriptor,
  SimEvent,
} from "@/lib/domain/types";

/**
 * A fully precomputed mock dataset for one run.
 *
 * The job engine reveals `time`/`values` progressively to emulate a streaming
 * solver; nothing is computed in the browser and nothing is recomputed while
 * streaming.
 */
export interface MockTruth {
  /** Independent axis: seconds for TDS/IBR, iteration index for PF/SSSA. */
  time: number[];
  axisLabel: string;
  axisUnit: string;
  signals: SignalDescriptor[];
  values: Record<string, number[]>;
  events: SimEvent[];
  /** Log lines keyed by the sample index at which they are emitted. */
  logPlan: { index: number; level: "debug" | "info" | "warn" | "error"; source: string; message: string }[];
  stages: { fromFraction: number; label: string }[];
  /** Wall-clock duration the mock job should take, in ms. */
  targetDurationMs: number;
  /** Deterministic outcome for this run. */
  outcome: Extract<RunStatus, "converged" | "failed">;
  failureReason?: string;
  failureCode?: string;
  warnings: string[];
  buildResult: (status: RunStatus, revealedSamples: number) => AnalysisResult;
}

export type TruthBuilder = (config: AnalysisConfig, seed: number) => MockTruth;
