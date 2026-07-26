/**
 * In-memory job engine that emulates the REST + SSE surface of the Python
 * solver service: queueing, progress, streamed logs, partial sample chunks,
 * event markers, cancellation and final results.
 *
 * Every dataset is precomputed deterministically from the run seed and then
 * revealed over wall-clock time; no numerical algorithm runs here and none runs
 * in the browser.
 */

import {
  DEFAULT_IBR_OPTIONS,
  DEFAULT_PF_OPTIONS,
  DEFAULT_TS_OPTIONS,
  findCase,
  solverLabel,
} from "@/lib/domain/catalog";
import type {
  AnalysisConfig,
  AuditEntry,
  DashboardStats,
  HealthReport,
  LogRecord,
  Page,
  Preset,
  RunDetail,
  RunProgress,
  RunRequest,
  RunResultPayload,
  RunStatus,
  RunStreamEvent,
  RunSummary,
  SeriesChunk,
  WorkerHealth,
} from "@/lib/domain/types";
import { isTerminal } from "@/lib/domain/types";

import { buildIbrTruth } from "./datasets/ibr";
import { buildPfTruth } from "./datasets/pf";
import { buildSssaTruth } from "./datasets/sssa";
import { buildTsTruth } from "./datasets/ts";
import { hashSeed, mulberry32 } from "./rng";
import type { MockTruth } from "./truth";

const TICK_MS = 220;

interface Job {
  detail: RunDetail;
  truth: MockTruth;
  logs: LogRecord[];
  chunks: SeriesChunk[];
  revealed: number;
  emittedLogPlan: number;
  emittedEvents: Set<string>;
  seq: number;
  startedAtMs: number;
  timer: ReturnType<typeof setInterval> | null;
  subscribers: Set<(event: RunStreamEvent) => void>;
  /** Lazily materialised for seeded historical runs. */
  materialised: boolean;
}

interface EngineState {
  jobs: Map<string, Job>;
  order: string[];
  audit: AuditEntry[];
  presets: Preset[];
  counter: number;
  bootedAt: number;
}

const WORKERS: WorkerHealth[] = [
  { id: "solver-01", status: "idle", queueDepth: 0, cpuPct: 12, memPct: 34, currentRunId: null, lastHeartbeat: new Date().toISOString() },
  { id: "solver-02", status: "idle", queueDepth: 0, cpuPct: 8, memPct: 28, currentRunId: null, lastHeartbeat: new Date().toISOString() },
  { id: "solver-03", status: "idle", queueDepth: 0, cpuPct: 5, memPct: 22, currentRunId: null, lastHeartbeat: new Date().toISOString() },
  { id: "solver-04", status: "offline", queueDepth: 0, cpuPct: 0, memPct: 0, currentRunId: null, lastHeartbeat: new Date(Date.now() - 420_000).toISOString() },
];

function buildTruth(config: AnalysisConfig, seed: number): MockTruth {
  const truth = ((): MockTruth => {
    switch (config.analysis) {
      case "pf":
        return buildPfTruth(config, seed);
      case "sssa":
        return buildSssaTruth(config, seed);
      case "ts":
        return buildTsTruth(config, seed);
      case "ibr":
        return buildIbrTruth(config, seed);
    }
  })();
  truth.logPlan.sort((a, b) => a.index - b.index);
  return truth;
}

function modelOf(config: AnalysisConfig): string | null {
  if (config.analysis === "ts" || config.analysis === "sssa") return config.options.model;
  if (config.analysis === "ibr") return config.options.ibr_analysis;
  return null;
}

function defaultLabel(config: AnalysisConfig): string {
  const descriptor = findCase(config.case);
  const suffix = modelOf(config);
  return `${descriptor?.name ?? config.case}${suffix ? ` · ${suffix}` : ""}`;
}

function emptyProgress(): RunProgress {
  return {
    fraction: 0,
    simTime: null,
    simEnd: null,
    step: 0,
    totalSteps: null,
    elapsedMs: 0,
    etaMs: null,
    stage: "queued",
  };
}

function environment(seed: number): RunDetail["environment"] {
  return {
    solverVersion: "power-flow-py 0.1.0",
    python: "3.12.6",
    numpy: "2.1.3",
    scipy: "1.14.1",
    host: "solver-01",
    seed,
  };
}

class MockEngine {
  private readonly state: EngineState;

  constructor(state: EngineState) {
    this.state = state;
  }

  /* ------------------------------------------------------------- creation */

  submit(request: RunRequest, user: string): RunDetail {
    const config = request.config;
    this.state.counter += 1;
    const id = `run-${String(this.state.counter).padStart(4, "0")}`;
    const seed = hashSeed(`${id}:${config.analysis}:${config.case}`);
    const truth = buildTruth(config, seed);
    const now = new Date();

    const detail: RunDetail = {
      id,
      label: request.label?.trim() || defaultLabel(config),
      analysis: config.analysis,
      caseId: config.case,
      caseName: findCase(config.case)?.name ?? config.case,
      solver: solverLabel(config.analysis, config.options),
      model: modelOf(config),
      status: "queued",
      startedAt: now.toISOString(),
      finishedAt: null,
      durationMs: null,
      converged: null,
      iterations: null,
      maxMismatch: null,
      worker: "solver-01",
      user,
      warnings: 0,
      config,
      progress: { ...emptyProgress(), simEnd: config.analysis === "ts" || config.analysis === "ibr" ? truth.time.at(-1) ?? null : null, totalSteps: truth.time.length },
      reason: null,
      errorCode: null,
      finiteStatus: null,
      signals: truth.signals,
      events: [],
      environment: environment(seed),
    };

    const job: Job = {
      detail,
      truth,
      logs: [],
      chunks: [],
      revealed: 0,
      emittedLogPlan: 0,
      emittedEvents: new Set(),
      seq: 0,
      startedAtMs: Date.now(),
      timer: null,
      subscribers: new Set(),
      materialised: true,
    };
    this.state.jobs.set(id, job);
    this.state.order.unshift(id);
    this.appendAudit({ user, action: "run.submit", runId: id, detail: `${config.analysis.toUpperCase()} on ${config.case}` });
    this.start(job);
    return job.detail;
  }

  private start(job: Job): void {
    this.setStatus(job, "queued");
    const queueDelay = 400 + Math.round(600 * mulberry32(job.detail.environment.seed)());
    setTimeout(() => {
      if (isTerminal(job.detail.status)) return;
      this.setStatus(job, "initializing");
      this.pushLog(job, "info", "scheduler", `Dispatched to worker ${job.detail.worker}.`);
      setTimeout(() => {
        if (isTerminal(job.detail.status)) return;
        this.setStatus(job, "running");
        job.startedAtMs = Date.now();
        job.timer = setInterval(() => this.tick(job), TICK_MS);
      }, 500);
    }, queueDelay);
  }

  private tick(job: Job): void {
    const total = job.truth.time.length;
    const perTick = Math.max(1, Math.ceil(total / Math.max(1, job.truth.targetDurationMs / TICK_MS)));
    const next = Math.min(total, job.revealed + perTick);
    if (next === job.revealed) return;

    const chunk: SeriesChunk = {
      seq: ++job.seq,
      t: job.truth.time.slice(job.revealed, next),
      values: {},
    };
    for (const signal of job.truth.signals) {
      chunk.values[signal.id] = job.truth.values[signal.id]?.slice(job.revealed, next) ?? [];
    }
    job.revealed = next;
    job.chunks.push(chunk);
    this.emit(job, { type: "samples", runId: job.detail.id, chunk });

    // Logs whose planned index has been reached (logPlan is index-sorted).
    const records: LogRecord[] = [];
    while (job.emittedLogPlan < job.truth.logPlan.length) {
      const entry = job.truth.logPlan[job.emittedLogPlan]!;
      if (entry.index >= next) break;
      records.push(this.makeLog(job, entry.level, entry.source, entry.message));
      job.emittedLogPlan += 1;
    }
    if (records.length > 0) {
      job.logs.push(...records);
      this.emit(job, { type: "log", runId: job.detail.id, records });
    }

    // Event markers crossed in this tick.
    const cutTime = job.truth.time[next - 1] ?? 0;
    for (const event of job.truth.events) {
      if (job.emittedEvents.has(event.id)) continue;
      if (event.t <= cutTime) {
        job.emittedEvents.add(event.id);
        job.detail.events = [...job.detail.events, event];
        this.emit(job, { type: "event", runId: job.detail.id, event });
      }
    }

    this.updateProgress(job, next, total);

    if (next >= total) this.finish(job, job.truth.outcome);
  }

  private updateProgress(job: Job, revealed: number, total: number): void {
    const fraction = revealed / total;
    const elapsedMs = Date.now() - job.startedAtMs;
    const stage = [...job.truth.stages].reverse().find((item) => fraction >= item.fromFraction)?.label ?? "running";
    const timeAxis = job.detail.analysis === "ts" || job.detail.analysis === "ibr";
    job.detail.progress = {
      fraction: Number(fraction.toFixed(4)),
      simTime: timeAxis ? job.truth.time[revealed - 1] ?? 0 : null,
      simEnd: timeAxis ? job.truth.time.at(-1) ?? null : null,
      step: revealed,
      totalSteps: total,
      elapsedMs,
      etaMs: fraction > 0.02 ? Math.max(0, Math.round(elapsedMs / fraction - elapsedMs)) : null,
      stage,
    };
    this.emit(job, { type: "progress", runId: job.detail.id, progress: job.detail.progress });
  }

  private finish(job: Job, status: Extract<RunStatus, "converged" | "failed">): void {
    if (job.timer) clearInterval(job.timer);
    job.timer = null;
    const result = job.truth.buildResult(status, job.revealed);
    job.detail.finishedAt = new Date().toISOString();
    job.detail.durationMs = Date.now() - job.startedAtMs;
    job.detail.converged = status === "converged";
    job.detail.warnings = job.truth.warnings.length;
    job.detail.reason = job.truth.failureReason ?? (status === "converged" ? "tolerance_met" : "failed");
    job.detail.errorCode = status === "failed" ? job.truth.failureCode ?? "solver_failed" : null;
    job.detail.finiteStatus = "all_finite";
    if (result.kind === "pf") {
      job.detail.iterations = result.iterations;
      job.detail.maxMismatch = result.maxMismatch;
    }
    this.pushLog(
      job,
      status === "converged" ? "info" : "error",
      "worker",
      status === "converged"
        ? `Run finished successfully in ${(job.detail.durationMs / 1000).toFixed(1)} s.`
        : `Run failed: ${job.detail.reason}`,
    );
    this.setStatus(job, status);
    this.emit(job, { type: "done", runId: job.detail.id, status });
  }

  cancel(runId: string, user: string): RunDetail | null {
    const job = this.state.jobs.get(runId);
    if (!job) return null;
    if (isTerminal(job.detail.status)) return job.detail;
    if (job.timer) clearInterval(job.timer);
    job.timer = null;
    job.detail.finishedAt = new Date().toISOString();
    job.detail.durationMs = Date.now() - job.startedAtMs;
    job.detail.converged = false;
    job.detail.reason = "cancelled_by_user";
    job.detail.warnings = job.truth.warnings.length;
    this.pushLog(job, "warn", "scheduler", `Cancellation requested by ${user}; worker released.`);
    this.setStatus(job, "cancelled");
    this.emit(job, { type: "done", runId, status: "cancelled" });
    this.appendAudit({ user, action: "run.cancel", runId, detail: `Cancelled at ${(job.detail.progress.fraction * 100).toFixed(1)} %` });
    return job.detail;
  }

  delete(runId: string, user: string): boolean {
    const job = this.state.jobs.get(runId);
    if (!job) return false;
    if (job.timer) clearInterval(job.timer);
    this.state.jobs.delete(runId);
    this.state.order = this.state.order.filter((item) => item !== runId);
    this.appendAudit({ user, action: "run.delete", runId, detail: `Deleted ${job.detail.label}` });
    return true;
  }

  /* -------------------------------------------------------------- reading */

  get(runId: string): RunDetail | null {
    const job = this.state.jobs.get(runId);
    return job ? job.detail : null;
  }

  result(runId: string): RunResultPayload | null {
    const job = this.state.jobs.get(runId);
    if (!job) return null;
    if (!isTerminal(job.detail.status)) return null;
    const status = job.detail.status;
    const revealed = job.revealed > 0 ? job.revealed : job.truth.time.length;
    return {
      run: job.detail,
      result: job.truth.buildResult(status, revealed),
      warnings: job.truth.warnings,
      inputSnapshot: job.detail.config,
    };
  }

  list(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: RunStatus[];
    analysis?: string[];
    from?: string;
    to?: string;
    sort?: string;
    direction?: "asc" | "desc";
  }): Page<RunSummary> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, query.pageSize ?? 20));
    const search = (query.search ?? "").trim().toLowerCase();
    let items = this.state.order
      .map((id) => this.state.jobs.get(id))
      .filter((job): job is Job => Boolean(job))
      .map((job) => this.toSummary(job));

    if (search) {
      items = items.filter((item) =>
        [item.id, item.label, item.caseId, item.caseName, item.solver, item.model ?? "", item.user]
          .join(" ")
          .toLowerCase()
          .includes(search),
      );
    }
    if (query.status && query.status.length > 0) {
      items = items.filter((item) => query.status!.includes(item.status));
    }
    if (query.analysis && query.analysis.length > 0) {
      items = items.filter((item) => query.analysis!.includes(item.analysis));
    }
    if (query.from) {
      const from = Date.parse(query.from);
      if (!Number.isNaN(from)) items = items.filter((item) => Date.parse(item.startedAt) >= from);
    }
    if (query.to) {
      const to = Date.parse(query.to) + 24 * 3600 * 1000;
      if (!Number.isNaN(to)) items = items.filter((item) => Date.parse(item.startedAt) <= to);
    }

    const direction = query.direction === "asc" ? 1 : -1;
    const sort = query.sort ?? "startedAt";
    items.sort((a, b) => {
      if (sort === "durationMs") return ((a.durationMs ?? 0) - (b.durationMs ?? 0)) * direction;
      if (sort === "caseId") return a.caseId.localeCompare(b.caseId) * direction;
      return (Date.parse(a.startedAt) - Date.parse(b.startedAt)) * direction;
    });

    const total = items.length;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total, page, pageSize };
  }

  stats(): DashboardStats {
    const all = this.state.order
      .map((id) => this.state.jobs.get(id))
      .filter((job): job is Job => Boolean(job))
      .map((job) => job.detail);
    const durations = all.filter((item) => item.durationMs !== null).map((item) => item.durationMs ?? 0);
    const random = mulberry32(4711);
    const points = 96;
    const trend = { t: [] as number[], voltagePu: [] as number[], frequencyHz: [] as number[] };
    for (let index = 0; index < points; index += 1) {
      trend.t.push(index * 15);
      trend.voltagePu.push(Number((1.02 + 0.012 * Math.sin(index / 7) + 0.004 * (random() - 0.5)).toFixed(5)));
      trend.frequencyHz.push(Number((60 + 0.045 * Math.sin(index / 5 + 1.2) + 0.012 * (random() - 0.5)).toFixed(5)));
    }
    return {
      totalRuns: all.length,
      converged: all.filter((item) => item.status === "converged").length,
      failed: all.filter((item) => item.status === "failed").length,
      running: all.filter((item) => !isTerminal(item.status)).length,
      cancelled: all.filter((item) => item.status === "cancelled").length,
      avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : 0,
      trend,
    };
  }

  health(): HealthReport {
    const active = this.state.order
      .map((id) => this.state.jobs.get(id))
      .filter((job): job is Job => Boolean(job))
      .filter((job) => !isTerminal(job.detail.status));
    const workers = WORKERS.map((worker, index) => {
      const job = active[index];
      if (worker.status === "offline") return { ...worker };
      return {
        ...worker,
        status: job ? ("busy" as const) : ("idle" as const),
        currentRunId: job?.detail.id ?? null,
        queueDepth: job ? 1 : 0,
        cpuPct: job ? 62 + index * 5 : worker.cpuPct,
        memPct: job ? 48 + index * 4 : worker.memPct,
        lastHeartbeat: new Date().toISOString(),
      };
    });
    const online = workers.filter((worker) => worker.status !== "offline").length;
    return {
      status: online >= 3 ? "ok" : online > 0 ? "degraded" : "down",
      solverVersion: "power-flow-py 0.1.0",
      queueDepth: Math.max(0, active.length - online),
      workers,
      uptimeS: Math.round((Date.now() - this.state.bootedAt) / 1000),
      checkedAt: new Date().toISOString(),
    };
  }

  /* --------------------------------------------------------- subscription */

  subscribe(runId: string, fromSeq: number, listener: (event: RunStreamEvent) => void): (() => void) | null {
    const job = this.state.jobs.get(runId);
    if (!job) return null;
    listener({
      type: "snapshot",
      run: job.detail,
      logs: job.logs.filter((record) => record.seq > fromSeq),
      chunks: job.chunks.filter((chunk) => chunk.seq > fromSeq),
    });
    if (isTerminal(job.detail.status)) {
      listener({ type: "done", runId, status: job.detail.status });
      return () => undefined;
    }
    job.subscribers.add(listener);
    return () => job.subscribers.delete(listener);
  }

  /* ---------------------------------------------------------- presets etc */

  presets(): Preset[] {
    return [...this.state.presets];
  }

  savePreset(input: Omit<Preset, "id" | "createdAt" | "owner">, user: string): Preset {
    const preset: Preset = {
      ...input,
      id: `preset-${this.state.presets.length + 1}`,
      createdAt: new Date().toISOString(),
      owner: user,
    };
    this.state.presets = [preset, ...this.state.presets];
    this.appendAudit({ user, action: "preset.save", runId: null, detail: preset.name });
    return preset;
  }

  deletePreset(id: string): boolean {
    const before = this.state.presets.length;
    this.state.presets = this.state.presets.filter((item) => item.id !== id);
    return this.state.presets.length < before;
  }

  audit(query: { page?: number; pageSize?: number; search?: string; action?: string; runId?: string }): Page<AuditEntry> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(5, query.pageSize ?? 25));
    let items = [...this.state.audit].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const search = (query.search ?? "").trim().toLowerCase();
    if (search) {
      items = items.filter((item) => `${item.user} ${item.action} ${item.detail} ${item.runId ?? ""}`.toLowerCase().includes(search));
    }
    if (query.action) items = items.filter((item) => item.action === query.action);
    if (query.runId) items = items.filter((item) => item.runId === query.runId);
    const total = items.length;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total, page, pageSize };
  }

  appendAudit(entry: Omit<AuditEntry, "id" | "at" | "ip">): void {
    this.state.audit.push({
      ...entry,
      id: `audit-${this.state.audit.length + 1}`,
      at: new Date().toISOString(),
      ip: "127.0.0.1",
    });
  }

  /* -------------------------------------------------------------- helpers */

  private toSummary(job: Job): RunSummary {
    const { config: _config, progress: _progress, signals: _signals, events: _events, environment: _environment, ...summary } = job.detail;
    return summary;
  }

  private setStatus(job: Job, status: RunStatus): void {
    job.detail.status = status;
    if (status === "running" && job.detail.progress.stage === "queued") {
      job.detail.progress = { ...job.detail.progress, stage: job.truth.stages[0]?.label ?? "running" };
    }
    this.emit(job, { type: "status", runId: job.detail.id, status, at: new Date().toISOString() });
  }

  private makeLog(job: Job, level: LogRecord["level"], source: string, message: string): LogRecord {
    return { seq: ++job.seq, at: new Date().toISOString(), level, source, message };
  }

  private pushLog(job: Job, level: LogRecord["level"], source: string, message: string): void {
    const record = this.makeLog(job, level, source, message);
    job.logs.push(record);
    this.emit(job, { type: "log", runId: job.detail.id, records: [record] });
  }

  private emit(job: Job, event: RunStreamEvent): void {
    for (const listener of job.subscribers) listener(event);
  }

  /* -------------------------------------------------------------- seeding */

  seedHistory(): void {
    if (this.state.order.length > 0) return;
    const random = mulberry32(90210);
    const users = ["dana.okafor", "miguel.ferrer", "ines.halvorsen"];
    const seeds: { config: AnalysisConfig; status: Extract<RunStatus, "converged" | "failed" | "cancelled">; ageH: number }[] = [];

    const pfCases = ["ieee14", "rts24", "ieee30", "case9", "ieee300", "matpower14", "saadat67"];
    for (const [index, caseId] of pfCases.entries()) {
      seeds.push({
        config: {
          analysis: "pf",
          case: caseId,
          options: {
            ...DEFAULT_PF_OPTIONS,
            pf_method: (["newton_raphson", "fdpf_xb", "gauss_seidel", "fdpf_bx"] as const)[index % 4]!,
            tolerance: index % 3 === 0 ? 1e-8 : 1e-6,
            max_iter: index === 4 ? 3 : 20,
          },
        },
        status: index === 4 ? "failed" : "converged",
        ageH: 2 + index * 3.4,
      });
    }
    const sssaCases: { case: string; model: "classical" | "emf6" | "padiyar_1_1_avr" }[] = [
      { case: "rts24", model: "classical" },
      { case: "kundur", model: "emf6" },
      { case: "padiyar_two_area", model: "padiyar_1_1_avr" },
      { case: "ieee14", model: "classical" },
    ];
    for (const [index, item] of sssaCases.entries()) {
      seeds.push({
        config: { analysis: "sssa", case: item.case, options: { model: item.model } },
        status: "converged",
        ageH: 5 + index * 7.1,
      });
    }
    const tsCases: { case: string; model: "classical" | "emf6" | "padiyar_1_1_avr" }[] = [
      { case: "kundur", model: "emf6" },
      { case: "matpower14", model: "classical" },
      { case: "padiyar_two_area", model: "padiyar_1_1_avr" },
      { case: "rts24", model: "classical" },
    ];
    for (const [index, item] of tsCases.entries()) {
      seeds.push({
        config: {
          analysis: "ts",
          case: item.case,
          options: {
            ...DEFAULT_TS_OPTIONS,
            model: item.model,
            t_end: 1 + index * 0.5,
            dt: 0.005,
            fault_bus: index % 2 === 0 ? 7 : null,
            integrator: index === 3 ? "rk4" : "trapezoidal",
          },
        },
        status: index === 2 ? "cancelled" : "converged",
        ageH: 9 + index * 9.7,
      });
    }
    const ibrCases: { case: string; product: "full" | "sssa" | "ts" | "sssa_load_sweep" }[] = [
      { case: "ieee14_switch", product: "full" },
      { case: "two_ibr_switch", product: "full" },
      { case: "gfl_rms10_smib", product: "ts" },
      { case: "gfm_no_pll_smib", product: "sssa" },
      { case: "gfl_rms10_loaded_smib", product: "sssa_load_sweep" },
      { case: "padiyar_switch", product: "full" },
      { case: "gfm_vsm_sakimoto_smib", product: "ts" },
    ];
    for (const [index, item] of ibrCases.entries()) {
      seeds.push({
        config: {
          analysis: "ibr",
          case: item.case,
          options: {
            ...DEFAULT_IBR_OPTIONS,
            ibr_analysis: item.product,
            t_end: item.case.endsWith("_switch") ? 6 : 0.05,
            dt: item.case.endsWith("_switch") ? 0.002 : 0.001,
          },
        },
        status: index === 6 ? "failed" : "converged",
        ageH: 1.2 + index * 11.3,
      });
    }

    for (const item of seeds) {
      this.state.counter += 1;
      const id = `run-${String(this.state.counter).padStart(4, "0")}`;
      const seed = hashSeed(`${id}:${item.config.analysis}:${item.config.case}`);
      const truth = buildTruth(item.config, seed);
      const startedAt = new Date(Date.now() - item.ageH * 3600 * 1000);
      const durationMs = Math.round(truth.targetDurationMs * (0.6 + 0.8 * random()));
      const revealed = item.status === "cancelled" ? Math.max(1, Math.round(truth.time.length * 0.42)) : truth.time.length;
      const materialised = truth.buildResult(item.status === "cancelled" ? "cancelled" : item.status, revealed);
      const user = users[this.state.counter % users.length]!;
      const detail: RunDetail = {
        id,
        label: defaultLabel(item.config),
        analysis: item.config.analysis,
        caseId: item.config.case,
        caseName: findCase(item.config.case)?.name ?? item.config.case,
        solver: solverLabel(item.config.analysis, item.config.options),
        model: modelOf(item.config),
        status: item.status,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
        durationMs,
        converged: item.status === "converged",
        iterations: materialised.kind === "pf" ? materialised.iterations : null,
        maxMismatch: materialised.kind === "pf" ? materialised.maxMismatch : null,
        worker: `solver-0${(this.state.counter % 3) + 1}`,
        user,
        warnings: truth.warnings.length,
        config: item.config,
        progress: {
          fraction: revealed / truth.time.length,
          simTime: item.config.analysis === "ts" || item.config.analysis === "ibr" ? truth.time[revealed - 1] ?? null : null,
          simEnd: item.config.analysis === "ts" || item.config.analysis === "ibr" ? truth.time.at(-1) ?? null : null,
          step: revealed,
          totalSteps: truth.time.length,
          elapsedMs: durationMs,
          etaMs: 0,
          stage: item.status === "cancelled" ? "cancelled" : "complete",
        },
        reason: item.status === "converged" ? "tolerance_met" : item.status === "cancelled" ? "cancelled_by_user" : truth.failureReason ?? "solver_failed",
        errorCode: item.status === "failed" ? truth.failureCode ?? "not_converged" : null,
        finiteStatus: "all_finite",
        signals: truth.signals,
        events: truth.events.filter((event) => event.t <= (truth.time[revealed - 1] ?? 0)),
        environment: environment(seed),
      };
      const logs: LogRecord[] = truth.logPlan
        .filter((entry) => entry.index < revealed)
        .slice(0, 400)
        .map((entry, index) => ({
          seq: index + 1,
          at: new Date(startedAt.getTime() + (index / 400) * durationMs).toISOString(),
          level: entry.level,
          source: entry.source,
          message: entry.message,
        }));
      const job: Job = {
        detail,
        truth,
        logs,
        chunks: [
          {
            seq: logs.length + 1,
            t: truth.time.slice(0, revealed),
            values: Object.fromEntries(truth.signals.map((signal) => [signal.id, truth.values[signal.id]?.slice(0, revealed) ?? []])),
          },
        ],
        revealed,
        emittedLogPlan: truth.logPlan.length,
        emittedEvents: new Set(detail.events.map((event) => event.id)),
        seq: logs.length + 1,
        startedAtMs: startedAt.getTime(),
        timer: null,
        subscribers: new Set(),
        materialised: true,
      };
      this.state.jobs.set(id, job);
      this.state.order.push(id);
      this.state.audit.push({
        id: `audit-${this.state.audit.length + 1}`,
        at: startedAt.toISOString(),
        user,
        action: "run.submit",
        runId: id,
        detail: `${item.config.analysis.toUpperCase()} on ${item.config.case}`,
        ip: "10.20.4.11",
      });
      if (item.status === "cancelled") {
        this.state.audit.push({
          id: `audit-${this.state.audit.length + 1}`,
          at: new Date(startedAt.getTime() + durationMs).toISOString(),
          user,
          action: "run.cancel",
          runId: id,
          detail: "Cancelled at 42.0 %",
          ip: "10.20.4.11",
        });
      }
    }

    this.state.order.sort((a, b) => {
      const left = this.state.jobs.get(a)?.detail.startedAt ?? "";
      const right = this.state.jobs.get(b)?.detail.startedAt ?? "";
      return Date.parse(right) - Date.parse(left);
    });

    this.state.presets = [
      {
        id: "preset-1",
        name: "IEEE14 tight NR",
        description: "Newton-Raphson with 1e-10 tolerance and Q-limits enforced.",
        config: { analysis: "pf", case: "ieee14", options: { ...DEFAULT_PF_OPTIONS, tolerance: 1e-10, max_iter: 30 } },
        createdAt: new Date(Date.now() - 86_400_000 * 4).toISOString(),
        owner: "dana.okafor",
        shared: true,
      },
      {
        id: "preset-2",
        name: "Kundur EMF6 fault study",
        description: "0.6 s bus-7 fault, trapezoidal, 5 ms step.",
        config: {
          analysis: "ts",
          case: "kundur",
          options: { ...DEFAULT_TS_OPTIONS, model: "emf6", t_end: 2, dt: 0.005, fault_bus: 7, t_fault: 0.5, t_clear: 0.58 },
        },
        createdAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
        owner: "miguel.ferrer",
        shared: true,
      },
      {
        id: "preset-3",
        name: "IEEE14 AGSI++ trip/reclose",
        description: "1 SG + 4 IBR switching study, 6 s at 2 ms.",
        config: {
          analysis: "ibr",
          case: "ieee14_switch",
          options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "full", t_end: 6, dt: 0.002 },
        },
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        owner: "dana.okafor",
        shared: false,
      },
    ];

    // One live run so the dashboard and run monitor have streaming data on boot.
    this.submit(
      {
        config: {
          analysis: "ibr",
          case: "ieee14_switch",
          options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "full", t_end: 6, dt: 0.002 },
        },
        label: "IEEE14 AGSI++ live monitor",
      },
      "dana.okafor",
    );
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __pfwEngine: { engine: MockEngine } | undefined;
}

export function getEngine(): MockEngine {
  if (!globalThis.__pfwEngine) {
    const state: EngineState = {
      jobs: new Map(),
      order: [],
      audit: [],
      presets: [],
      counter: 0,
      bootedAt: Date.now(),
    };
    const engine = new MockEngine(state);
    engine.seedHistory();
    globalThis.__pfwEngine = { engine };
  }
  return globalThis.__pfwEngine.engine;
}

export type { MockEngine };
