import type {
  AuditEntry,
  CaseDescriptor,
  DashboardStats,
  HealthReport,
  Page,
  Preset,
  RunDetail,
  RunRequest,
  RunResultPayload,
  RunSummary,
} from "../domain/types";
import {
  SolverRequestError,
  type AuditQuery,
  type RunQuery,
  type SolverClient,
  type StreamCallbacks,
  type StreamHandle,
} from "./client";
import { createRunStream } from "./stream";

function toSearchParams(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
      continue;
    }
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export interface HttpSolverClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class HttpSolverClient implements SolverClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpSolverClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_SOLVER_API_BASE ?? "/api";
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) {
      let code = `http_${response.status}`;
      let message = response.statusText || "Request failed";
      try {
        const body = (await response.json()) as { code?: string; message?: string };
        if (body.code) code = body.code;
        if (body.message) message = body.message;
      } catch {
        /* non-JSON error body */
      }
      throw new SolverRequestError(code, message, response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  listCases(): Promise<CaseDescriptor[]> {
    return this.request<CaseDescriptor[]>("/cases");
  }

  health(): Promise<HealthReport> {
    return this.request<HealthReport>("/health");
  }

  stats(): Promise<DashboardStats> {
    return this.request<DashboardStats>("/stats");
  }

  listRuns(query: RunQuery = {}): Promise<Page<RunSummary>> {
    return this.request<Page<RunSummary>>(`/runs${toSearchParams(query as Record<string, unknown>)}`);
  }

  getRun(runId: string): Promise<RunDetail> {
    return this.request<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
  }

  submitRun(request: RunRequest): Promise<RunDetail> {
    return this.request<RunDetail>("/runs", { method: "POST", body: JSON.stringify(request) });
  }

  cancelRun(runId: string): Promise<RunDetail> {
    return this.request<RunDetail>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }

  async deleteRun(runId: string): Promise<void> {
    await this.request<void>(`/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
  }

  getResult(runId: string): Promise<RunResultPayload> {
    return this.request<RunResultPayload>(`/runs/${encodeURIComponent(runId)}/result`);
  }

  listPresets(): Promise<Preset[]> {
    return this.request<Preset[]>("/presets");
  }

  savePreset(preset: Omit<Preset, "id" | "createdAt" | "owner">): Promise<Preset> {
    return this.request<Preset>("/presets", { method: "POST", body: JSON.stringify(preset) });
  }

  async deletePreset(id: string): Promise<void> {
    await this.request<void>(`/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listAudit(query: AuditQuery = {}): Promise<Page<AuditEntry>> {
    return this.request<Page<AuditEntry>>(`/audit${toSearchParams(query as Record<string, unknown>)}`);
  }

  streamRun(runId: string, callbacks: StreamCallbacks): StreamHandle {
    return createRunStream(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/stream`, callbacks);
  }
}

let singleton: SolverClient | null = null;

/** Shared browser-side client instance. */
export function getSolverClient(): SolverClient {
  if (!singleton) singleton = new HttpSolverClient();
  return singleton;
}

/** Test seam. */
export function setSolverClient(client: SolverClient | null): void {
  singleton = client;
}
