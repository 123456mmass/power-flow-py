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

## IBR SMIB event contract

- A balanced three-phase PCC fault is a temporary shunt admittance `1/Zf` in
  the terminal KCL over `[fault_on, fault_clear)`. A grid step permanently
  changes infinite-bus magnitude and phase at `step_on`.
- Events enter only the algebraic endpoint KCL. Differential equations and the
  previous-endpoint derivative in the implicit-trapezoidal rule are unchanged.
- Fault and grid-step trajectories start independently from the exact operating
  point. With no event options, legacy drift and perturbation results are
  bit-identical and no event trajectory is allocated.
- RMS10 balanced LVRT, modulation limits, and directional anti-windup, plus the
  Sakimoto limiter anti-windup, remain active during faults. Voltage-domain or
  Newton failures propagate as fail-closed errors; there is no silent fallback.

## Loaded-SMIB SSSA sweep

- `gfl_rms10_loaded_smib` and `gfm_no_pll_loaded_smib` place a constant-power
  shunt load at the converter terminal behind `Z_line=0.02+j0.20 pu`.
- The load scales at constant power factor; converter references remain fixed
  and the infinite bus absorbs incremental line flow. Every point is solved
  independently by coupled Newton with backtracking.
- SSSA includes the derivative of `conj((P_load+jQ_load)/V)` in the algebraic
  KCL and uses the project-owned Schur construction. Raw eigenvalue order is
  retained per point; a deterministic assignment supplies tracked ordering.
- Percentages must be finite, nonnegative, unique, and strictly increasing.
  Invalid schedules, low-voltage states, or singular Newton/Schur systems fail closed.

## Two-IBR AGSI++ switching diagnostic

- `two_ibr_switch` connects two identical reduced-six converters to one PCC.
- The symmetric numerical reduction uses one six-state trajectory with `2*I`
  in KCL while publishing separate device signals and transactions.
- A smooth temporary weak-grid window scales line impedance and may step the
  infinite-bus phasor. Coupled implicit trapezoidal integration is followed by
  a boundary supervisor decision.
- AGSI++ combines voltage, frequency, filtered RoCoF, active-power error, SCR,
  and frame-lock terms. Hysteresis commits current-continuous GFL/GFM state
  reinitialization; default operation produces one up/down transaction per device.

## IEEE14 one-SG/four-IBR switching diagnostic

- `ieee14_switch` uses the in-house tap-aware IEEE14 Newton power flow, folds
  loads into the dynamic admittance, and replaces generator buses 2, 3, 6,
  and 8 with switchable reduced-six IBRs.
- The bus-1 synchronous generator is the four-state Padiyar model 1.1 with
  manual constant-field excitation, Kodsi Gen1 parameters converted from its
  615 MVA machine base, and primary droop. No AVR or PSS is substituted.
- Converter states remain on their individual inverter bases; network current
  injections and reported P/Q use the common 100 MVA system base. The 1.2 pu
  current limit is applied only at the network-injection boundary.
- The project-owned composite DAE has 28 differential and 28 algebraic states.
  SSSA eliminates the network Jacobian by a Schur complement. TDS uses coupled
  implicit trapezoidal integration, an SG trip/reclose transaction, and
  index-driven bidirectional AGSI/AGSI++ transfers.
- The default active MATLAB fixture is the numerical oracle. PF, eigenvalues,
  trip/reclose transactions, selected trajectories, AGSI, P/Q, and voltage
  minima are regression-gated; no packaged power-system library is involved.

## Padiyar one-SG/three-IBR switching diagnostic

- `padiyar_switch` retains the project-owned Padiyar two-area passive network
  and constant-impedance loads. The model-1.1 AVR machine at bus 11 remains an
  SG; machine buses 1, 2, and 12 become switchable reduced-six IBRs.
- The SG has five states and primary droop. Together with three six-state IBRs,
  the reduced composite has 23 differential states and 20 rectangular network
  variables. Converter internal states use individual machine bases, while KCL
  currents and reported powers use the 100 MVA system base.
- The SG-online SSSA operating point contains one positive real mode in the
  active MATLAB baseline. The Python route reports that instability faithfully;
  it does not tune, clamp, or relabel the physical mode to force a stable result.
- Default TDS trips the bus-11 SG at 1 second and synchronously recloses it at
  4 seconds. Reference handback and subsequent per-device AGSI++ decisions are
  atomic switch transactions. PF, eigenvalues, selected trajectories, P/Q,
  voltage minima, and all transactions are MATLAB-regression-gated.
