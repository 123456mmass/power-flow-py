# Solver service contract (REST + SSE)

The console talks to exactly one port: `SolverClient`
(`src/lib/solver/client.ts`). The bundled Next.js route handlers under
`src/app/api/**` implement this contract against an in-memory mock engine; a
Python job service can replace them without any UI change by serving the same
routes at `NEXT_PUBLIC_SOLVER_API_BASE`.

Option names inside `config.options` are the same keys accepted by
`power_flow.api.solve_case(analysis, case, options)`.

## Authentication

Session is a signed httpOnly cookie (`pfw_session`). Replace
`src/server/auth/*` to integrate a real identity provider; the UI only needs
`AuthAdapter`.

| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password, remember? }` | `200 { user, adapter }`, `401 invalid_credentials`, `423 account_locked`, `429 rate_limited` |
| POST | `/api/auth/logout` | — | `200 { ok: true }` |
| GET | `/api/auth/session` | — | `200 { user \| null, adapter, supportsPasswordReset }` |
| POST | `/api/auth/forgot-password` | `{ email }` | `200 { ok, message }`, `501 unsupported` |

## Catalogue, health, statistics

| Method | Path | Response |
|---|---|---|
| GET | `/api/cases` | `CaseDescriptor[]` |
| GET | `/api/health` | `HealthReport` (unauthenticated liveness probe) |
| GET | `/api/stats` | `DashboardStats` |

## Runs

| Method | Path | Notes |
|---|---|---|
| GET | `/api/runs` | `page`, `pageSize`, `search`, `status`, `analysis`, `from`, `to`, `sort`, `direction`; returns `Page<RunSummary>` |
| POST | `/api/runs` | `{ config, label?, note? }` → `202 RunDetail`; `422 validation_error` with `errors: { "options.tolerance": "…" }`; `403 forbidden` for read-only roles |
| GET | `/api/runs/{id}` | `RunDetail` or `404 run_not_found` |
| DELETE | `/api/runs/{id}` | `204`; `403`/`404` |
| POST | `/api/runs/{id}/cancel` | `RunDetail` with `status: "cancelled"` |
| GET | `/api/runs/{id}/result` | `RunResultPayload`; `409 run_incomplete` while the run is not terminal |
| GET | `/api/runs/{id}/stream` | `text/event-stream`, `?fromSeq=<int>` |

## Stream protocol

Every message is a single JSON object in the SSE `data:` field. Comment lines
(`: ping`) are heartbeats sent every 15 s.

```ts
type RunStreamEvent =
  | { type: "snapshot"; run: RunDetail; logs: LogRecord[]; chunks: SeriesChunk[] }
  | { type: "status";   runId: string; status: RunStatus; at: string }
  | { type: "progress"; runId: string; progress: RunProgress }
  | { type: "log";      runId: string; records: LogRecord[] }
  | { type: "samples";  runId: string; chunk: SeriesChunk }
  | { type: "event";    runId: string; event: SimEvent }
  | { type: "done";     runId: string; status: RunStatus }
  | { type: "error";    runId: string; code: string; message: string };
```

Sequencing rules the client relies on:

1. `LogRecord.seq` and `SeriesChunk.seq` share one monotonic counter per run.
2. The first message after connecting is always `snapshot`; with `fromSeq=N` it
   contains only logs and chunks whose `seq > N`.
3. `done` is the last message; the server closes the stream after sending it.
4. Reconnecting with `fromSeq` equal to the highest received `seq` must not
   replay or skip samples — `tests/unit/stream.test.ts` and
   `tests/integration/mock-engine.test.ts` pin this behaviour.

`SeriesChunk` carries a batch of samples so the browser appends instead of
re-rendering:

```ts
interface SeriesChunk {
  seq: number;
  t: number[];                        // simulated seconds, or iteration index
  values: Record<string, number[]>;   // keyed by SignalDescriptor.id
}
```

## Presets and audit

| Method | Path | Notes |
|---|---|---|
| GET | `/api/presets` | `Preset[]` |
| POST | `/api/presets` | `{ name, description, shared, config }` → `201 Preset` |
| DELETE | `/api/presets/{id}` | `204` |
| GET | `/api/audit` | `page`, `pageSize`, `search`, `action`, `runId` → `Page<AuditEntry>` |

## Error envelope

```json
{ "code": "validation_error", "message": "options.dt: Time step must be smaller than the end time",
  "errors": { "options.dt": "Time step must be smaller than the end time" } }
```

`code` values used by the UI: `unauthenticated`, `forbidden`,
`validation_error`, `invalid_body`, `run_not_found`, `run_incomplete`,
`preset_not_found`, `stream_unavailable`. Python `PowerFlowError.code` values
(`tolerance`, `max_iter`, `unknown_pf_method`, `not_converged`, …) pass through
unchanged in `RunDetail.errorCode`.
