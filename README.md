# power-flow-py

Contract-first Python reimplementation of the active in-house MATLAB power-flow and stability toolkit.

The project implements its own numerical algorithms. NumPy and SciPy are used only for general array and linear-algebra primitives; no packaged power-system solver is used.

## Current milestone

- Immutable `power_case/1.0` network contract
- IEEE 5-bus and IEEE 14-bus cases
- Y-bus construction with shunts, off-nominal taps, and phase shifts
- In-house Newton-Raphson, Gauss-Seidel, FDPF-XB, and FDPF-BX AC power flow
- Phase-1 backward/forward sweep for radial PQ-only networks (fail-closed capability guard)
- Shared PV reactive-limit switching and structured failure semantics
- CLI and Python API
- Frozen and live MATLAB differential verification

PF, SSSA, TS, and IBR are the planned public analysis surfaces. Only PF is enabled in this first milestone; unsupported analyses fail closed.

## Install and run

```powershell
python -m pip install -e ".[dev]"
pytest
power-flow --case ieee5 --method fdpf_xb --tolerance 1e-10 --max-iter 50
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
