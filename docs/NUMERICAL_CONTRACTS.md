# Numerical contracts

## Network case

- Schema: `power_case/1.0`
- Bus columns: `[bus, type, Vm, Va_deg, Pg, Qg, Pd, Qd, Gsh, Bsh, Qmin, Qmax]`
- Line columns: `[from, to, R, X, Bhalf, tap, phase_deg]`
- Internal bus types: `1=REF`, `2=PV`, `3=PQ`
- Scheduled injection: `P=Pg-Pd`, `Q=Qg-Qd`
- Complex power injection: `S = V * conj(Ybus * V)`

External bus IDs are preserved at the API boundary. Internal indices are zero-based and never inferred from an external ID.

## Newton-Raphson state

The state is ordered as:

1. voltage angles for all PV and PQ buses, in case row order;
2. voltage magnitudes for all PQ buses, in case row order.

The mismatch uses the same order: active-power mismatch for PV/PQ followed by reactive-power mismatch for PQ.

Iteration order is fixed: mismatch, finiteness, convergence, analytic Jacobian, finiteness, conditioning, linear solve, step finiteness, update, state finiteness, positive-PQ-voltage guard.

Invalid schemas raise `PowerFlowError` with a stable code. Numerical failures return a structured non-converged `PowerFlowResult`.

## MATLAB oracle

MATLAB is a behavioral oracle, not mathematical authority. If its behavior conflicts with an authoritative sourced equation, the differential gate stops and records a defect instead of copying the discrepancy.

## Classical SSSA

- One coherent classical machine is formed per online generator bus, preserving
  source bus-row order rather than PF state order.
- Cases without machine data use the documented defaults `H=5 s`, `D=0`, and
  `Xdp=0.3 pu`; cases with machine data aggregate by external bus ID.
- Constant-power loads are converted to operating-point admittances before the
  internal-voltage network solve.
- `K_Pe_delta` uses an absolute central-difference step of `1e-6 rad`.
- Full states use machine-block order `[delta_1, omega_1, ...]`.
- COI reduction removes the common angle and speed modes using inertia weights.
- Reduced roots are classified with real-part tolerance `1e-7` as unstable,
  stable, or marginal.

## Classical transient simulation

- Differential state order is `[delta(1..ng), omega(1..ng)]` in source
  generator-bus row order.
- The linear network solve uses the same internal voltage, transient reactance,
  and constant-admittance load model as classical SSSA.
- Fixed-step integrators are implicit trapezoidal, classical RK4, and backward
  Euler. RK4 is diagnostic because it has a bounded stability region.
- Fault topology is `Yfault = Ypre + e_f e_f' / Zf`.
- A step arriving at an event uses the left topology. The public sample at the
  event is reconstructed with the right topology; differential state is continuous.
- The MATLAB fixed-step recorder has a characterized floating-comparison defect
  at `t_clear` that can publish the faulted left-limit V/Pe. Python follows the
  declared right-limit event contract instead of reproducing that defect.

## Operational EMF6 stability model

- The Kundur default SSSA and TS route shares one nonlinear DAE. Per-machine
  state order is `[delta, omega_deviation, Eqp, Edp, Eqpp, Edpp]`; algebraic
  state order is interleaved `[Re(V1), Im(V1), ...]`.
- Machine/network conversion follows the Kundur-book dq convention. Loads use
  `cc_p_cz_q` by default: constant-current active power and constant-impedance
  reactive power at the solved operating voltage.
- Equilibrium is initialized from the in-house Newton-Raphson PF and a damped
  scalar Newton rotor-angle solve. SSSA forms all four DAE Jacobian blocks by
  central differences and eliminates algebraic states by Schur complement.
- The production EMF6 TS slice is fixed-step implicit trapezoidal with three
  fixed Picard correctors and a project-owned damped-Newton algebraic solve.
  Unsupported EMF6 integrators and adaptive corrector mode fail closed.
- A differential step uses the topology at its left endpoint. At a fault or
  clear boundary the algebraic voltage and electrical power sample is solved
  with the right-side topology while the differential state remains continuous.

## Padiyar model-1.1 stability model

- The AVR per-machine state order is
  `[delta, omega_absolute, Eqp, Edp, Efd]`; manual excitation omits `Efd` and
  holds the initialized field voltage constant. Algebraic voltage remains
  interleaved real/imaginary by source bus-row order.
- Loads are converted to constant impedances at the solved operating point.
  The machine uses the two-axis transient equations and Kundur-book dq/network
  current convention; no subtransient states or inferred parameters are added.
- The AVR equation is `(KA*(Vref-|V|)-Efd)/TA`. SSSA uses an absolute central
  difference step of `1e-6` and the full Schur-complement matrix. Its two gauge
  roots are retained rather than removed by COI projection, matching the active
  MATLAB route.
- Padiyar TS uses a fixed time grid with implicit trapezoidal predictor/corrector.
  Corrector iteration is residual-adaptive (maximum 12 iterations by default),
  while each algebraic network solve uses project-owned damped Newton. Other
  Padiyar integrators currently fail closed.
