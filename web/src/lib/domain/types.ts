/**
 * Domain contracts shared by the UI, the typed solver client and the mock
 * REST/SSE layer.
 *
 * Field names mirror the Python option keys accepted by
 * `power_flow.api.solve_case(analysis, case, options)` so that a live backend
 * can consume the exact same payloads without a translation layer.
 *
 * No numerical algorithm lives in this package: the browser only renders
 * values produced by the solver service.
 */

export const ANALYSIS_KINDS = ["pf", "sssa", "ts", "ibr"] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

export const PF_METHODS = [
  "newton_raphson",
  "gauss_seidel",
  "fdpf_xb",
  "fdpf_bx",
  "bfs",
] as const;
export type PfMethod = (typeof PF_METHODS)[number];

export const DYNAMIC_MODELS = [
  "classical",
  "emf6",
  "padiyar_1_1_avr",
  "padiyar_1_1_manual",
] as const;
export type DynamicModel = (typeof DYNAMIC_MODELS)[number];

export const INTEGRATORS = ["trapezoidal", "rk4", "backward_euler"] as const;
export type Integrator = (typeof INTEGRATORS)[number];

export const IBR_PRODUCTS = ["pf", "sssa", "ts", "full", "sssa_load_sweep"] as const;
export type IbrProduct = (typeof IBR_PRODUCTS)[number];

export const RUN_STATUSES = [
  "queued",
  "initializing",
  "running",
  "converged",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = ["converged", "failed", "cancelled"];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/* ------------------------------------------------------------------ options */

export interface PfOptions {
  pf_method: PfMethod;
  tolerance: number;
  max_iter: number;
  enforce_q_limits: boolean;
  acceleration: number;
  q_limit_tolerance: number;
  max_q_limit_switches: number;
}

export interface SssaOptions {
  model: DynamicModel;
}

export interface TsOptions {
  model: DynamicModel;
  integrator: Integrator;
  t_end: number;
  dt: number;
  fault_bus: number | null;
  t_fault: number;
  t_clear: number;
}

export interface IbrOptions {
  ibr_analysis: IbrProduct;
  t_end: number;
  dt: number;
  fault_on: number;
  fault_clear: number;
  fault_reactance: number;
  step_on: number;
  step_dv: number;
  step_dphase_deg: number;
  sssa_load_percentages: number[];
}

export type AnalysisOptions = PfOptions | SssaOptions | TsOptions | IbrOptions;

export type AnalysisConfig =
  | { analysis: "pf"; case: string; options: PfOptions }
  | { analysis: "sssa"; case: string; options: SssaOptions }
  | { analysis: "ts"; case: string; options: TsOptions }
  | { analysis: "ibr"; case: string; options: IbrOptions };

/** Request body accepted by `POST /api/runs`. */
export interface RunRequest {
  config: AnalysisConfig;
  label?: string;
  note?: string;
}

/* --------------------------------------------------------------- catalogue */

export interface CaseDescriptor {
  id: string;
  name: string;
  buses: number;
  branches: number;
  generators: number;
  ibrDevices: number;
  radial: boolean;
  analyses: AnalysisKind[];
  defaultModel?: DynamicModel;
  provenance: string;
  readiness: "production" | "diagnostic";
}

export interface SignalDescriptor {
  id: string;
  label: string;
  group: string;
  unit: string;
  /** Preferred chart panel for this signal. */
  panel: SignalPanel;
  device?: string;
}

export type SignalPanel =
  | "voltage"
  | "angle"
  | "frequency"
  | "power"
  | "agsi"
  | "mode"
  | "residual";

/* -------------------------------------------------------------------- runs */

export interface RunProgress {
  /** 0..1 */
  fraction: number;
  /** Simulated time in seconds, when the analysis is time-domain. */
  simTime: number | null;
  simEnd: number | null;
  step: number;
  totalSteps: number | null;
  elapsedMs: number;
  etaMs: number | null;
  stage: string;
}

export interface RunSummary {
  id: string;
  label: string;
  analysis: AnalysisKind;
  caseId: string;
  caseName: string;
  solver: string;
  model: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  converged: boolean | null;
  iterations: number | null;
  maxMismatch: number | null;
  worker: string;
  user: string;
  warnings: number;
}

export interface RunDetail extends RunSummary {
  config: AnalysisConfig;
  progress: RunProgress;
  reason: string | null;
  errorCode: string | null;
  finiteStatus: string | null;
  signals: SignalDescriptor[];
  events: SimEvent[];
  environment: RunEnvironment;
}

export interface RunEnvironment {
  solverVersion: string;
  python: string;
  numpy: string;
  scipy: string;
  host: string;
  seed: number;
}

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogRecord {
  seq: number;
  /** ISO timestamp. */
  at: string;
  level: LogLevel;
  source: string;
  message: string;
}

export const SIM_EVENT_KINDS = [
  "fault",
  "clear",
  "trip",
  "reclose",
  "mode_switch",
  "limit",
  "step",
] as const;
export type SimEventKind = (typeof SIM_EVENT_KINDS)[number];

export interface SimEvent {
  id: string;
  kind: SimEventKind;
  /** Simulated time in seconds. */
  t: number;
  label: string;
  detail: string;
  device: string | null;
  severity: "info" | "warning" | "fault";
}

/** A batch of streamed samples; `values` is keyed by signal id. */
export interface SeriesChunk {
  seq: number;
  t: number[];
  values: Record<string, number[]>;
}

/* ------------------------------------------------------------------ stream */

export type RunStreamEvent =
  | { type: "snapshot"; run: RunDetail; logs: LogRecord[]; chunks: SeriesChunk[] }
  | { type: "status"; runId: string; status: RunStatus; at: string }
  | { type: "progress"; runId: string; progress: RunProgress }
  | { type: "log"; runId: string; records: LogRecord[] }
  | { type: "samples"; runId: string; chunk: SeriesChunk }
  | { type: "event"; runId: string; event: SimEvent }
  | { type: "done"; runId: string; status: RunStatus }
  | { type: "error"; runId: string; code: string; message: string };

/* ----------------------------------------------------------------- results */

export interface BusRow {
  busId: number;
  name: string;
  type: "REF" | "PV" | "PQ";
  vMagPu: number;
  vAngleDeg: number;
  pGenMw: number;
  qGenMvar: number;
  pLoadMw: number;
  qLoadMvar: number;
  qLimitHit: "none" | "min" | "max";
}

export interface BranchRow {
  branchId: number;
  fromBus: number;
  toBus: number;
  pFromMw: number;
  qFromMvar: number;
  pToMw: number;
  qToMvar: number;
  pLossMw: number;
  qLossMvar: number;
  loadingPct: number;
}

export interface QLimitEventRow {
  round: number;
  busId: number;
  fromType: string;
  toType: string;
  qBeforeMvar: number;
  qFixedMvar: number;
  limitType: string;
}

export interface PfResult {
  kind: "pf";
  systemName: string;
  method: string;
  converged: boolean;
  reason: string;
  finiteStatus: string;
  iterations: number;
  maxMismatch: number;
  mismatchHistory: number[];
  pLossTotalMw: number;
  qLossTotalMvar: number;
  pTotalGenMw: number;
  qTotalGenMvar: number;
  pTotalLoadMw: number;
  qTotalLoadMvar: number;
  buses: BusRow[];
  branches: BranchRow[];
  qLimitEvents: QLimitEventRow[];
}

export interface EigenMode {
  index: number;
  real: number;
  imag: number;
  frequencyHz: number;
  dampingRatio: number;
  timeConstantS: number | null;
  classification: "stable" | "marginal" | "unstable";
  dominantState: string;
  participation: number;
}

export interface SssaResult {
  kind: "sssa";
  systemName: string;
  model: string;
  stable: boolean;
  classification: string;
  stateCount: number;
  modes: EigenMode[];
  minDampingRatio: number;
  criticalModeIndex: number;
  coiReduction: boolean;
}

export interface TdsSeries {
  signalId: string;
  label: string;
  unit: string;
  panel: SignalPanel;
  values: number[];
}

export interface TdsResult {
  kind: "tds";
  systemName: string;
  model: string;
  integrator: string;
  dt: number;
  tEnd: number;
  converged: boolean;
  steps: number;
  time: number[];
  series: TdsSeries[];
  events: SimEvent[];
  maxAngleDeviationDeg: number;
  maxFrequencyDeviationHz: number;
}

export interface SwitchTransaction {
  id: string;
  t: number;
  device: string;
  from: string;
  to: string;
  trigger: string;
  agsi: number;
  vPccPu: number;
  accepted: boolean;
  note: string;
}

export interface SwitchingResult extends Omit<TdsResult, "kind"> {
  kind: "switching";
  transactions: SwitchTransaction[];
  devices: { id: string; label: string; type: "SG" | "GFL" | "GFM"; bus: number }[];
}

export type AnalysisResult = PfResult | SssaResult | TdsResult | SwitchingResult;

export interface RunResultPayload {
  run: RunDetail;
  result: AnalysisResult;
  warnings: string[];
  inputSnapshot: AnalysisConfig;
}

/* ------------------------------------------------------- presets and audit */

export interface Preset {
  id: string;
  name: string;
  description: string;
  config: AnalysisConfig;
  createdAt: string;
  owner: string;
  shared: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  user: string;
  action:
    | "login"
    | "logout"
    | "run.submit"
    | "run.cancel"
    | "run.delete"
    | "run.duplicate"
    | "preset.save"
    | "export";
  runId: string | null;
  detail: string;
  ip: string;
}

/* ----------------------------------------------------------------- health */

export interface WorkerHealth {
  id: string;
  status: "idle" | "busy" | "offline";
  queueDepth: number;
  cpuPct: number;
  memPct: number;
  currentRunId: string | null;
  lastHeartbeat: string;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  solverVersion: string;
  queueDepth: number;
  workers: WorkerHealth[];
  uptimeS: number;
  checkedAt: string;
}

export interface DashboardStats {
  totalRuns: number;
  converged: number;
  failed: number;
  running: number;
  cancelled: number;
  avgDurationMs: number;
  trend: { t: number[]; voltagePu: number[]; frequencyHz: number[] };
}

/* ------------------------------------------------------------------- pages */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}
