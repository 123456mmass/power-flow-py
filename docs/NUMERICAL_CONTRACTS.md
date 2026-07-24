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
