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

## Reduced-six IBR SMIB diagnostics

- Case IDs `gfl_reduced6_smib` and `gfm_reduced6_smib` are source-frozen
  `ASSUMED_DIAGNOSTIC` fixtures. They do not claim production readiness for
  multi-bus IBR studies.
- Both devices use six differential states and two algebraic terminal-voltage
  components. Network KCL is `I_device - (V-V_inf)/Z_line = 0` with generator
  injection convention `S=V*conj(I)`.
- GFL state order is `[i_d, i_q, delta_PLL, xi_PLL, xi_P, xi_Q]`. The PLL PI
  output is a rad/s deviation and is not multiplied by base angular frequency.
- GFM state order is `[i_d, i_q, omega, delta, E, xi_V]`. It has no PLL; angle
  comes only from the virtual swing equation. The voltage loop retains the
  source cross-pairing between dq voltage errors and current references.
- SSSA uses absolute central differences at `1e-6` and algebraic Schur
  elimination. TDS solves the complete eight-variable implicit-trapezoidal
  endpoint residual by project-owned Newton at every step.
- Products `pf`, `sssa`, `ts`, and `full` are explicit. Unported IBR case IDs
  raise `ibr_case_not_implemented`; no model substitution or fallback occurs.

## Primary GFL/GFM SMIB diagnostics

- `gfl_rms10_smib` has fixed state order
  `[delta_PLL, xi_PLL, P_f, Q_f, xi_P, xi_Q, xi_id, xi_iq, i_d, i_q]`.
  It retains the source runtime PLL scaling, P/Q filters, outer and current PI
  loops, modulation clamp, and normal-domain current-priority guard. Its very
  fast PLL pole is an honest computed result, not filtered from the spectrum.
- `gfm_no_pll_smib` has state order
  `[delta_vsm, delta_omega_vsm, P_f, Q_f]`. It contains no PLL state or runtime
  terminal-angle tracker. The internal Thevenin voltage angle evolves only from
  the virtual swing equation, while voltage magnitude follows algebraic Q-V droop.
- The GFM no-PLL fixture runs at 50 Hz; GFL-RMS10 runs at 60 Hz. Both preserve
  system/inverter base conversion and use the same verified SMIB KCL, Schur,
  and coupled implicit-trapezoidal engines as the reduced-six cases.

## Sakimoto VSM SMIB diagnostic

- `gfm_vsm_sakimoto_smib` uses fixed state order
  `[i_d, i_q, xi_id, xi_iq, omega_R, delta, x_gov, T_m, x_d]`.
- The construction has no PLL, AVR, or PSS. The runtime angle derivative is
  exclusively `omega_b*(omega_R-1)`; terminal voltage cannot directly reset or
  track the angle state.
- Equilibrium solves the physical load angle by bracketed bisection, then
  back-solves the Q reference required by the static Q-V droop. Current-PI,
  governor, turbine, and damper states are initialized to zero their respective
  runtime equations rather than copied from a published modal table.
- Current commands use the Sakimoto impedance map with a project-derived radial
  limit. The source-frozen diagnostic remains fail-closed below its balanced
  positive-sequence voltage floor.
