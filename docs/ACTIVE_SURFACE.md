# Active surface

The source MATLAB baseline exposes four stable analysis IDs: `pf`, `sssa`, `ts`, and `ibr`. This repository will reimplement them as verified vertical slices.

## Included

- Public launchers, registries, case loaders, and their transitive numerical dependencies
- Public GUI/API behavior that still has an active consumer
- Active contract and regression behavior
- Pure validation helpers that do not call an external power-system solver
- Static case data, including data whose provenance names MATPOWER or PGAz

## Excluded

- Archived `legacy/` implementations
- Documentation probes and dated diagnostic scripts
- Generated output, figures, PDFs, and temporary files
- Executable PSAT/PGAz/MATPOWER cross-validation runners
- Reserved or unapproved numerical methods that have no active runtime route

`ASSUMED_DIAGNOSTIC` is a readiness classification, not an inactivity marker. A diagnostic scenario remains in scope when it is exposed through an active public route.

## Milestone status

| Analysis | Status |
|---|---|
| PF | 14-case catalog; NR, GS, FDPF-XB/BX; Phase-1 radial BFS capability-gated |
| SSSA | Classical on all 14 cases; Kundur EMF6 and Padiyar model-1.1 AVR defaults; manual detailed variants; MATLAB parity |
| TS | Classical fixed-step trapezoidal/BE and RK4 diagnostic; Kundur EMF6 and Padiyar model-1.1 fixed trapezoidal; fault events |
| IBR | Reduced-six GFL/GFM SMIB PF-equilibrium, Schur SSSA, and implicit-trapezoidal TDS; remaining cases fail closed |
