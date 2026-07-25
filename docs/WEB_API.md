# Web solver API

The optional `power-flow-api` service adapts the typed numerical API to the
REST/SSE contract consumed by the Next.js application. Install it with
`python -m pip install -e ".[web]"` and run `power-flow-api`.

## Endpoints

- `GET /api/cases`, `/api/health`, `/api/stats`
- `GET|POST /api/runs`
- `GET|DELETE /api/runs/{id}`
- `POST /api/runs/{id}/cancel`
- `GET /api/runs/{id}/result`
- `GET /api/runs/{id}/stream?fromSeq=N`
- `GET|POST /api/presets`, `DELETE /api/presets/{id}`
- `GET /api/audit`

Run submission accepts the frontend `RunRequest` contract:

```json
{
  "label": "IEEE14 PF",
  "config": {
    "analysis": "pf",
    "case": "ieee14",
    "options": {
      "pf_method": "newton_raphson",
      "tolerance": 1e-10,
      "max_iter": 50,
      "enforce_q_limits": false,
      "acceleration": 1.4,
      "q_limit_tolerance": 1e-6,
      "max_q_limit_switches": 20
    }
  }
}
```

## SSE contract

The stream sends JSON in the SSE `data` field. Event variants are `snapshot`,
`status`, `progress`, `log`, `samples`, `event`, `done`, and `error`. Log and
sample chunks share a monotonic sequence. Reconnecting clients pass the last
sequence as `fromSeq`; the first response is a current snapshot plus history
newer than that sequence.

FastAPI's native `EventSourceResponse` supplies keep-alive comments and the
headers needed to prevent intermediary buffering. The current in-process
worker is intended for local development and a single server. Queued jobs can
be cancelled immediately. A running numerical call observes cancellation at
the solver boundary; hard cancellation will require the planned process-worker
adapter.

All power-system calculations continue to execute in `power_flow.api.solve_case`.
The HTTP layer contains no numerical power-system algorithms.
