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
- Operational sixth-order EMF (`EMF6`) DAE SSSA for the Kundur default route
- Padiyar model-1.1 AVR/manual DAE SSSA for the two-area default route
- Classical fixed-step TS with trapezoidal, RK4, and Backward-Euler integrators
- Kundur EMF6 fixed-step trapezoidal TS with nonlinear algebraic network solves
- Padiyar model-1.1 AVR/manual fixed-step trapezoidal TS
- Reduced six-state GFL/GFM single-infinite-bus IBR PF/SSSA/TDS diagnostics
- GFL-RMS10 and four-state GFM-VSG no-PLL SMIB PF/SSSA/TDS diagnostics
- Nine-state GFM-VSM Sakimoto no-PLL/no-AVR/no-PSS SMIB diagnostics
- PCC shunt-fault and infinite-bus magnitude/phase-step IBR SMIB events
- Loaded GFL-RMS10/GFM-no-PLL SMIB equilibrium, Schur SSSA, and load sweep
- Two-device common-PCC AGSI++ GFL/GFM switching with weak-grid events
- CLI and Python API
- Frozen and live MATLAB differential verification

PF, classical SSSA/TS, Kundur EMF6, and Padiyar model-1.1 SSSA/TS routes are
enabled. IBR SMIB coverage includes reduced-six GFL/GFM, GFL-RMS10, four-state
GFM-VSG no-PLL, and nine-state Sakimoto VSM diagnostics; other IBR cases fail closed.

Active PF case IDs are `ieee5`, `ieee14`, `ieee300`, `rts24`,
`padiyar_two_area`, `kundur_two_area`, `matpower14`, `case9`, `matpower30`,
`saadat67`, `saadat68`, `ieee30`, `template`, and `kundur`.

## Install and run

```powershell
python -m pip install -e ".[dev]"
pytest
power-flow --case ieee5 --method fdpf_xb --tolerance 1e-10 --max-iter 50
power-flow --analysis sssa --case rts24
power-flow --analysis ts --case matpower14 --model classical --integrator trapezoidal
power-flow --analysis ts --case kundur --model emf6 --t-end 0.2 --dt 0.005
power-flow --analysis ts --case padiyar_two_area --model padiyar_1_1_avr --t-end 0.2
power-flow --analysis ibr --case gfl_reduced6_smib --ibr-product full --t-end 0.05
power-flow --analysis ibr --case gfm_no_pll_smib --ibr-product sssa
power-flow --analysis ibr --case gfm_vsm_sakimoto_smib --ibr-product full --t-end 0.05
power-flow --analysis ibr --case gfl_rms10_smib --ibr-product ts --t-end 0.03 --dt 0.001 --ibr-fault-on 0.01 --ibr-fault-clear 0.02
power-flow --analysis ibr --case gfl_rms10_loaded_smib --ibr-product sssa_load_sweep --ibr-load-percentages 0 20 40 60 80
power-flow --analysis ibr --case two_ibr_switch --ibr-product full --t-end 8 --dt 0.001
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
