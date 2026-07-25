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

IEEE14 and Padiyar switching simulations publish samples directly from the
accepted implicit-trapezoidal timestep loop. The default stream stride is ten
steps (20 ms of simulated time at the 2 ms study timestep). Signal IDs are:

- `bus.{bus}.v`
- `ibr.{bus}.frequency`, `.p`, `.q`, `.agsi`, and `.mode`
- `solver.residual`

Mode uses `0` for GFL and `1` for GFM. Every committed transition also emits an
`event` immediately with `kind="mode_switch"`, the simulated event time, device,
direction, trigger, and AGSI value. Reclose reference handback is emitted as a
GFM-to-GFL transaction even when another AGSI decision occurs at the same
simulation time. This lets the frontend animate both atomic transitions rather
than inferring them from a decimated curve.

FastAPI's native `EventSourceResponse` supplies keep-alive comments and the
headers needed to prevent intermediary buffering. The current in-process
worker is intended for local development and a single server. Queued jobs can
be cancelled immediately. IEEE14/Padiyar integration observes cancellation at
every timestep; other numerical routes currently observe it at the solver
boundary. Hard cancellation for every route will require the planned
process-worker adapter.

All power-system calculations continue to execute in `power_flow.api.solve_case`.
The HTTP layer contains no numerical power-system algorithms.
