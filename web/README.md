# Grid Analysis Console

Scientific operator frontend for the project-owned power-system solver
(`power-flow-py`). It submits study configurations, streams job telemetry, and
renders power-flow, small-signal, time-domain and IBR results.

**No numerical algorithm runs in this package.** The browser plots values the
solver service produced; the mock layer under `src/server/mock/**` only replays
precomputed display fixtures.

- Next.js 16.2.11 (App Router) · React 19 · TypeScript strict
- Tailwind CSS v4 (`@tailwindcss/postcss`, CSS-first tokens)
- Radix UI primitives + cmdk (accessible headless components, no admin template)
- uPlot for dense streaming traces, Plotly for the eigenvalue complex plane
- Vitest + Testing Library (unit/integration), Playwright (e2e + screenshots)

## Quick start

```powershell
cd web
npm install
copy .env.example .env.local     # demo credentials + session secret
npm run dev                      # http://localhost:3000
```

Sign in with a development account (shown on the login page while
`NEXT_PUBLIC_ENABLE_DEMO_CREDENTIALS=true`):

| Email | Password | Role | Capability |
|---|---|---|---|
| `engineer@grid.local` | `Stability!2026` | engineer | submit, cancel, delete, presets |
| `analyst@grid.local` | `Eigenvalue!2026` | analyst | read, compare, export |
| `viewer@grid.local` | `Observer!2026` | viewer | read-only |
| `locked@grid.local` | `Locked!2026` | viewer | demonstrates the locked-account state |

A live IEEE 14-bus AGSI++ run (1 SG + 4 switchable IBRs, 6 s at 2 ms) starts
when the server boots, so the dashboard and run monitor have streaming data
immediately.

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `npm test` | Vitest unit + integration suites |
| `npm run e2e` | Playwright suites (auto-starts `next start -p 3100`) |
| `npm run e2e:install` | Download the Chromium build for Playwright |
| `npm run screenshots` | Re-capture `screenshots/` |

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SOLVER_API_BASE` | `/api` | Browser REST/SSE path. Keep `/api` for the same-origin proxy. |
| `SOLVER_API_BASE` | unset | Python REST/SSE base URL, e.g. `http://127.0.0.1:8000/api`. When set, server-rendered pages and `/api` solver routes use the Python service; otherwise the bundled mock is used. |
| `NEXT_PUBLIC_ENABLE_DEMO_CREDENTIALS` | unset | `true` shows the dev-only credential panel. Never enable outside local development. |
| `AUTH_SESSION_SECRET` | dev fallback | HMAC key for the signed session cookie. Set a strong value anywhere shared. |

## Information architecture

```
/login                        unauthenticated shell (no marketing page)
/                             → /dashboard (or /login)
/dashboard                    fleet status: summary cards, trends, recent runs, worker health
/analysis/new                 configuration workspace (?analysis, ?case, ?from=<runId>)
/runs                         history: search, status/analysis chips, date range, pagination
/runs/[runId]                 real-time monitor: state, progress, live charts, log console
/results                      index of terminal runs
/results/[runId]              result workspace: overview, tables, plots, exports, print report
/compare?runs=a,b             aligned-axis overlay + metric table with declared tolerances
/presets                      stored configurations
/logs                         audit trail (user, action, time, run id)
/settings                     session, backend connection, streaming preferences
/api/**                       mock REST + SSE implementation of the solver contract
```

Navigation: collapsible sidebar (`Ctrl/⌘+B`), top bar with global search,
backend connection indicator, notifications, theme toggle and user menu,
breadcrumbs, and a command palette (`Ctrl/⌘+K`) covering pages, quick analysis
starts, recent runs and the case catalogue.

## Component map

```
src/
├─ app/
│  ├─ layout.tsx                    theme bootstrap (no flash), skip link, metadata
│  ├─ (auth)/login/page.tsx         server guard → LoginForm
│  ├─ (app)/layout.tsx              session guard → AppShell
│  ├─ (app)/{dashboard,analysis,runs,results,compare,presets,logs,settings}/…
│  └─ api/…                         auth, cases, health, stats, runs, stream, result, presets, audit
├─ components/
│  ├─ shell/        AppShell · Sidebar · TopBar (connection/notifications/user) · Breadcrumbs · CommandPalette · nav-items
│  ├─ ui/           Button · Field/TextInput/NumberInput/Select/Checkbox/Switch · Panel/PanelHeader/StatCard/KeyValue
│  │                Badge/StatusBadge/ProgressBar/Skeleton/EmptyState/ErrorState/Sparkline · Dialog/ConfirmDialog/Tooltip/DropdownMenu
│  │                DataTable (sort, filter, column selection, CSV)
│  ├─ charts/       UplotChart (append-only streaming, zoom retention, event markers, PNG/SVG/CSV export)
│  │                SignalChart (panel frame + toolbar) · EigenvaluePlot (Plotly) · palette
│  ├─ analysis/     AnalysisWorkspace (context-sensitive forms, validation, JSON + CLI preview, presets)
│  ├─ runs/         RunMonitor · LogConsole · SignalTree · RunTable · RunHistoryTable · RunFilters
│  ├─ results/      ResultWorkspace (tabs + exports + print report) · PfResultView · SssaResultView · TdsResultView
│  ├─ compare/      CompareWorkspace (metric table with tolerances, aligned overlay, eigenvalue panels)
│  ├─ presets/      PresetList      logs/ AuditTable      settings/ SettingsPanels      auth/ LoginForm
│  └─ theme/        ThemeToggle
├─ lib/
│  ├─ domain/       types.ts (contracts) · catalog.ts (cases, solvers, defaults) · config-schema.ts (zod ranges) · cli.ts
│  ├─ solver/       client.ts (SolverClient port) · http-client.ts · stream.ts (resumable SSE + backoff)
│  ├─ hooks/        use-run-stream.ts (telemetry → charts without React re-render per sample)
│  └─ utils/        cn.ts · format.ts (numbers, durations, CSV, downloads)
└─ server/
   ├─ auth/         adapter.ts (AuthAdapter port) · mock-adapter.ts · session.ts (signed cookie)
   ├─ api/          helpers.ts (guards, query parsing, error envelope)
   ├─ data.ts       in-process read facade for server components
   └─ mock/         engine.ts (queue, progress, logs, samples, events, cancel, audit, presets)
                    datasets/{pf,sssa,ts,ibr}.ts · truth.ts · rng.ts
```

## Mock datasets

`src/server/mock/datasets/` builds a deterministic dataset per run (seeded from
the run id) and the engine reveals it over wall-clock time:

- **PF** — tabulated IEEE 14-bus solution (14 buses, 20 branches, PV→PQ
  reactive-limit event on bus 8), plus synthesized solutions for the other
  catalogue cases. Mismatch trajectories differ per solver family
  (quadratic for Newton-Raphson, geometric for Gauss-Seidel/FDPF/BFS).
- **SSSA** — eigenvalue sets sized from the case machine count and model state
  order (`classical`, `emf6`, `padiyar_1_1_*`) with an inter-area mode, local
  modes, damping ratios, participation and stability classification.
- **TDS** — per-machine rotor angle, frequency, terminal voltage, P/Q, COI
  frequency and network-solve residual with fault/clearing events.
- **IEEE14 AGSI++** — 1 SG at bus 1 plus 4 switchable IBRs (buses 2, 3, 6, 8):
  PCC voltage, frequency, P/Q, angle, AGSI++ grid-strength index and control
  mode per device; PCC fault, SG trip/reclose, and GFL↔GFM transitions with a
  switch-transaction table. 6 s at 2 ms ⇒ 3 000 samples × 23 signals.

## Streaming design

- One SSE connection per run; the server assigns a monotonic `seq` to every log
  record and sample batch (see `docs/API_CONTRACT.md`).
- `createRunStream` reconnects with exponential backoff (700 ms → 8 s, 8
  attempts) and resumes with `?fromSeq=<last seq>`, so no sample is lost or
  duplicated. Connection state is surfaced in the run header.
- Samples never enter React state. `useRunStream` hands each batch to the chart
  handles, which push into a mutable buffer and call `uPlot.setData(data, false)`
  inside one `requestAnimationFrame` — the x-scale is only advanced when the
  user has not zoomed, so zoom and pan survive live updates.
- Log console keeps the newest 4 000 records, renders the last 800 matches, and
  offers severity filters, search, autoscroll pause, copy and download.

## Testing

```powershell
npm run typecheck
npm test            # 46 tests: 5 files
npm run e2e         # 24 tests: auth, navigation, submission, streaming, results, visual
```

- `tests/unit/config-schema.test.ts` — numerical-range validation and
  fail-closed rules (BFS on meshed networks, dt ≥ t_end, step-count cap).
- `tests/unit/stream.test.ts` — reconnect/resume policy, backoff, attempt
  budget, malformed payloads, terminal close.
- `tests/unit/table-log.test.tsx` — result filtering, sorting, `aria-sort`,
  column selection, log severity/search filters.
- `tests/unit/cli-format.test.ts` — CLI reproducibility and formatting.
- `tests/integration/mock-engine.test.ts` — queue → stream → result lifecycle,
  cancellation with partial samples, cursor resume, filters, presets, audit.
- `tests/e2e/*.spec.ts` — login states, navigation and command palette,
  context-sensitive submission, streaming, cancellation, reconnect, result
  filtering, delete confirmation, compare, audit filters.
- `tests/e2e/visual.spec.ts` writes `screenshots/` at 1680×1050, 1366×900 and
  900×1200 for login, dashboard, run monitor, results (PF/SSSA/IBR), new
  analysis and run history, plus light-theme captures.

## Visual verification

`screenshots/` (28 PNGs, regenerate with `npm run screenshots`):

| Surface | Dark | Light |
|---|---|---|
| Login | `login-{desktop,laptop,tablet}-dark.png` | `login-desktop-light.png` |
| Dashboard | `dashboard-{desktop,laptop,tablet}-dark.png` | `dashboard-desktop-light.png` |
| Real-time run | `run-monitor-{desktop,laptop,tablet}-dark.png` | `run-monitor-desktop-light.png` |
| Results (PF) | `results-pf-{desktop,laptop,tablet}-dark.png` | `results-pf-desktop-light.png` |
| Results (SSSA) | `results-sssa-*-dark.png` | — |
| Results (IBR AGSI++) | `results-ibr-*-dark.png` | — |
| New analysis | `new-analysis-*-dark.png` | — |
| Run history | `runs-*-dark.png` | — |

## Accessibility and motion

- Semantic landmarks, skip link, one `h1` per page, labelled form controls with
  `aria-invalid`/`aria-describedby`, `aria-sort` on sortable headers,
  `role="log"` for the console, `aria-live` status text for run state.
- Keyboard: full tab order, visible `:focus-visible` rings, `Ctrl/⌘+K` palette,
  `Ctrl/⌘+B` sidebar, Enter/Space on table rows, Radix focus traps in dialogs.
- Dark and light themes are both first-class; tokens are chosen for contrast
  (light theme uses darker cyan/green/amber/red variants for text on white).
- `prefers-reduced-motion: reduce` collapses animations and transitions.

## Assumptions

1. **Two development backends.** Without `SOLVER_API_BASE`, the console uses
   the deterministic contract mock under `src/server/mock/**`. Set
   `SOLVER_API_BASE=http://127.0.0.1:8000/api` after starting `power-flow-api`
   to run every numerical study and live SSE stream through the project-owned
   Python service; no component changes are required.
2. **Display fixtures, not solver output.** Bus/branch/eigenvalue/time-series
   numbers, case bus counts and provenance strings are plausible fixtures for UI
   review. They must not be cited as solver results.
3. **Option names follow the Python surface** (`pf_method`, `tolerance`,
   `max_iter`, `enforce_q_limits`, `acceleration`, `model`, `integrator`,
   `t_end`, `dt`, `fault_bus`, `t_fault`, `t_clear`, `ibr_analysis`,
   `sssa_load_percentages`, …), including the per-method `max_iter` defaults.
4. **Validation is a UI pre-flight, not a solver gate.** Ranges mirror the
   documented fail-closed guards and add practical bounds (step-count cap, IBR
   `dt ≤ 50 ms`); the service remains authoritative.
5. **Comparison tolerances are review thresholds** shown next to each metric on
   `/compare`, not acceptance criteria.
6. **Auth is a replaceable port.** The in-memory adapter locks demo account
   `locked@grid.local` and rate-limits after 5 failures per address; sessions are
   signed httpOnly cookies (8 h, or 30 days with "remember"). Roles gate
   mutations: engineer/admin may submit, cancel, delete and save presets.
7. **State is per server process.** Runs, presets and audit entries live in
   memory (`globalThis`), so a restart reseeds the history; e2e tests therefore
   run in a single worker.
8. **System fonts only** (`ui-sans-serif` / `ui-monospace` stacks) so builds and
   air-gapped environments never depend on a font CDN.
9. **Plotly is loaded lazily** and only on result pages that need the complex
   plane; streaming panels use uPlot to keep dense updates cheap.
10. **SSE over WebSocket** because the telemetry is server→client only and SSE
    resumes cleanly with a sequence cursor. `SolverClient.streamRun` is the seam
    if a WebSocket transport is ever required.
