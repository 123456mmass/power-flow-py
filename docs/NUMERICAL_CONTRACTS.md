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
