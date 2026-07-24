# Repository instructions

These rules apply to the entire repository.

## Numerical integrity

- Production power-flow, stability, transient, and IBR algorithms are project-owned Python code.
- Do not add MATPOWER, pandapower, PYPOWER, PyPSA, GridCal, PSAT, PGAz, or another power-system solver as a dependency.
- NumPy and SciPy linear-algebra primitives are allowed. Production nonlinear solves, optimization algorithms, event handling, and time integrators remain project-owned.
- MATLAB is a verification oracle only. MATLAB results must never supply production initial states, parameters, corrections, or runtime decisions.
- Preserve the audited equation, state order, units, per-unit bases, frames, signs, stopping rules, limits, and fail-closed behavior.
- Declare comparison tolerances before inspecting new Python results. Never loosen a gate merely to obtain a pass.

## Development workflow

- Implement vertical slices with equation-level, solver-level, and end-to-end tests.
- Keep external bus IDs distinct from zero-based internal array positions.
- Keep verification tools beneath `verification/`; production code beneath `src/` must not import them.
- Preserve MATLAB provenance and readiness classifications. A diagnostic scenario does not become production-ready merely because it is reimplemented.
