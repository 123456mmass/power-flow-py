"""Project-owned Gauss-Seidel AC power-flow solver."""

from __future__ import annotations

import numpy as np

from power_flow.contracts import PowerCase, PowerFlowOptions, PowerFlowResult
from power_flow.network import calculate_power_injections, prepare_case
from power_flow.pf.common import build_result, full_mismatch, solve_with_q_limits


def _solve_round(case: PowerCase, opt: PowerFlowOptions) -> PowerFlowResult:
    model = prepare_case(case)
    phasor = model.voltage_spec * np.exp(1j * np.deg2rad(model.angle_spec_deg))
    history: list[float] = []
    converged = False
    reason = "max_iterations"
    finite_status = "all_finite"
    for _ in range(opt.max_iter):
        for bus in range(model.num_buses):
            if model.bus_type[bus] == 1:
                continue
            sum_yv = model.ybus[bus] @ phasor - model.ybus[bus, bus] * phasor[bus]
            if model.bus_type[bus] == 2:
                _, q_calc = calculate_power_injections(abs(phasor), np.angle(phasor), model.ybus)
                specified = complex(model.p_net[bus], q_calc[bus])
            else:
                specified = complex(model.p_net[bus], model.q_net[bus])
            raw = (np.conj(specified) / np.conj(phasor[bus]) - sum_yv) / model.ybus[bus, bus]
            updated = phasor[bus] + opt.acceleration * (raw - phasor[bus])
            if model.bus_type[bus] == 2:
                updated = model.voltage_spec[bus] * np.exp(1j * np.angle(updated))
            if not np.isfinite(updated) or abs(updated) <= 0:
                updated = 0.1 * np.exp(1j * np.angle(phasor[bus]))
            phasor[bus] = updated
        mismatch = full_mismatch(model, abs(phasor), np.angle(phasor))
        maximum = float(np.max(np.abs(mismatch))) if mismatch.size else 0.0
        history.append(maximum)
        if not np.all(np.isfinite(mismatch)):
            reason, finite_status = "nonfinite_system", "nonfinite_mismatch"
            break
        if maximum < opt.tolerance:
            converged, reason = True, "converged"
            break
    return build_result(
        model, abs(phasor), np.angle(phasor), history, converged, reason,
        finite_status, "gauss_seidel",
        {"method_source": "in-house Gauss-Seidel", "acceleration": opt.acceleration},
    )


def solve_gauss_seidel(case: PowerCase, options: PowerFlowOptions | None = None) -> PowerFlowResult:
    opt = options or PowerFlowOptions(pf_method="gauss_seidel", max_iter=200)
    return solve_with_q_limits(case, opt, _solve_round)
