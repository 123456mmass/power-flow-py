/**
 * Transport-agnostic solver client.
 *
 * The UI never talks to `fetch` directly; it depends on this interface only.
 * `HttpSolverClient` targets the REST + SSE contract documented in
 * `docs/API_CONTRACT.md`, which the bundled mock route handlers implement and a
 * live Python job service can implement without UI changes.
 */

import type {
  AuditEntry,
  DashboardStats,
  HealthReport,
  Page,
  Preset,
  RunDetail,
  RunRequest,
  RunResultPayload,
  RunStatus,
  RunSummary,
  CaseDescriptor,
  AnalysisKind,
  RunStreamEvent,
} from "../domain/types";

export interface RunQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: RunStatus[];
  analysis?: AnalysisKind[];
  from?: string;
  to?: string;
  sort?: "startedAt" | "durationMs" | "caseId";
  direction?: "asc" | "desc";
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  action?: string;
  runId?: string;
}

export interface StreamHandle {
  close: () => void;
}

export interface StreamCallbacks {
  onEvent: (event: RunStreamEvent) => void;
  onConnectionChange?: (state: "connecting" | "open" | "reconnecting" | "closed") => void;
  /** Last received chunk sequence, used for gap-free resume. */
  fromSeq?: number;
}

export interface SolverClient {
  listCases(): Promise<CaseDescriptor[]>;
  health(): Promise<HealthReport>;
  stats(): Promise<DashboardStats>;
  listRuns(query?: RunQuery): Promise<Page<RunSummary>>;
  getRun(runId: string): Promise<RunDetail>;
  submitRun(request: RunRequest): Promise<RunDetail>;
  cancelRun(runId: string): Promise<RunDetail>;
  deleteRun(runId: string): Promise<void>;
  getResult(runId: string): Promise<RunResultPayload>;
  listPresets(): Promise<Preset[]>;
  savePreset(preset: Omit<Preset, "id" | "createdAt" | "owner">): Promise<Preset>;
  deletePreset(id: string): Promise<void>;
  listAudit(query?: AuditQuery): Promise<Page<AuditEntry>>;
  streamRun(runId: string, callbacks: StreamCallbacks): StreamHandle;
}

export class SolverRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SolverRequestError";
    this.code = code;
    this.status = status;
  }
}
