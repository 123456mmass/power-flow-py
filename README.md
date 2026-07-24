# power-flow-py

Contract-first Python reimplementation of the active in-house MATLAB power-flow and stability toolkit.

The project implements its own numerical algorithms. NumPy and SciPy are used only for general array and linear-algebra primitives; no packaged power-system solver is used.

## Current milestone

- Immutable `power_case/1.0` network contract
- All 14 active network catalog cases, from 3 to 300 buses
- Y-bus construction with shunts, off-nominal taps, and phase shifts
- In-house Newton-Raphson, Gauss-Seidel, FDPF-XB, and FDPF-BX AC power flow
- Phase-1 backward/forward sweep for radial PQ-only networks (fail-closed capability guard)
- Shared PV reactive-limit switching and structured failure semantics
- Classical multimachine SSSA with COI reduction and stability classification
- CLI and Python API
- Frozen and live MATLAB differential verification

PF and classical SSSA are enabled. TS and IBR remain active planned surfaces and
fail closed until their verified vertical slices land.

Active PF case IDs are `ieee5`, `ieee14`, `ieee300`, `rts24`,
`padiyar_two_area`, `kundur_two_area`, `matpower14`, `case9`, `matpower30`,
`saadat67`, `saadat68`, `ieee30`, `template`, and `kundur`.

## Install and run

```powershell
python -m pip install -e ".[dev]"
pytest
power-flow --case ieee5 --method fdpf_xb --tolerance 1e-10 --max-iter 50
power-flow --analysis sssa --case rts24
```

Python API:

```python
from power_flow import solve_case

result = solve_case("pf", "ieee14", {"pf_method": "fdpf_xb", "tolerance": 1e-10})
print(result.converged, result.iterations, result.max_mismatch)
```

## Verification boundary

MATLAB adapters live under `verification/matlab`. They invoke the sibling MATLAB repository only to produce test fixtures. Nothing under `src/power_flow` imports MATLAB, a fixture, or verification code.

See [active surface](docs/ACTIVE_SURFACE.md) and [numerical contracts](docs/NUMERICAL_CONTRACTS.md).
