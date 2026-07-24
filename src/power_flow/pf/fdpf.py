"""Project-owned fast-decoupled AC power flow (XB and BX variants)."""

from __future__ import annotations

import numpy as np

from power_flow.contracts import PowerCase, PowerFlowError, PowerFlowOptions, PowerFlowResult
from power_flow.network import PowerFlowModel, prepare_case
from power_flow.pf.common import build_result, full_mismatch, solve_with_q_limits


def build_b_matrices(model: PowerFlowModel, variant: str) -> tuple[np.ndarray, np.ndarray]:
    variant = variant.upper()
    if variant not in {"XB", "BX"}:
        raise PowerFlowError("fdpf_variant", "FDPF variant must be XB or BX.")
    bp = np.zeros((model.num_buses, model.num_buses))
    bpp = np.zeros_like(bp)
    for row, start, end in zip(
        model.case.line_data, model.line_from_indices, model.line_to_indices, strict=True
    ):
        resistance, reactance, b_half, tap, _ = row[2:7]
        if reactance == 0:
            raise PowerFlowError("fdpf_zero_reactance", "FDPF requires non-zero branch reactance.")
        bp_series = 1.0 / reactance if variant == "XB" else reactance / (resistance**2 + reactance**2)
        bpp_series = reactance / (resistance**2 + reactance**2) if variant == "XB" else 1.0 / reactance
        bp[start, start] += bp_series
        bp[end, end] += bp_series
        bp[start, end] -= bp_series
        bp[end, start] -= bp_series
        bpp[start, start] += bpp_series + b_half
        bpp[end, end] += bpp_series + b_half
        bpp[start, end] -= bpp_series / tap
        bpp[end, start] -= bpp_series / tap
    bpp[np.diag_indices_from(bpp)] += model.b_shunt
    return bp, bpp


def _solve_round(case: PowerCase, opt: PowerFlowOptions, variant: str) -> PowerFlowResult:
    model = prepare_case(case)
    bp, bpp = build_b_matrices(model, variant)
    bp_reduced = bp[np.ix_(model.delta_indices, model.delta_indices)]
    bpp_reduced = bpp[np.ix_(model.voltage_indices, model.voltage_indices)]
    voltage = np.array(model.voltage_spec, copy=True)
    angle = np.deg2rad(model.angle_spec_deg)
    history: list[float] = []
    converged = False
    reason, finite_status = "max_iterations", "all_finite"
    for _ in range(opt.max_iter):
        mismatch = full_mismatch(model, voltage, angle)
        maximum = float(np.max(np.abs(mismatch))) if mismatch.size else 0.0
        history.append(maximum)
        if not np.all(np.isfinite(mismatch)):
            reason, finite_status = "nonfinite_system", "nonfinite_mismatch"
            break
        if maximum < opt.tolerance:
            converged, reason = True, "converged"
            break
        try:
            angle[model.delta_indices] += np.linalg.solve(
                bp_reduced, mismatch[: model.num_delta] / voltage[model.delta_indices]
            )
            updated = full_mismatch(model, voltage, angle)
            voltage[model.voltage_indices] += np.linalg.solve(
                bpp_reduced,
                updated[model.num_delta :] / voltage[model.voltage_indices],
            )
        except np.linalg.LinAlgError:
            reason, finite_status = "singular_decoupled_matrix", "singular_matrix"
            break
        if np.any(voltage <= 0) or not np.all(np.isfinite(voltage)):
            reason, finite_status = "nonfinite_state", "invalid_voltage"
            break
    variant = variant.upper()
    return build_result(
        model, voltage, angle, history, converged, reason, finite_status,
        f"fdpf_{variant.lower()}",
        {"method_variant": variant,
         "method_source": "in-house FDPF (Stott-Alsac 1974 + van Amerongen 1989)"},
    )


def solve_fdpf(
    case: PowerCase, options: PowerFlowOptions | None = None, variant: str = "XB"
) -> PowerFlowResult:
    opt = options or PowerFlowOptions(pf_method=f"fdpf_{variant.lower()}", max_iter=50)
    return solve_with_q_limits(case, opt, lambda current, current_opt: _solve_round(current, current_opt, variant))


def solve_fdpf_xb(case: PowerCase, options: PowerFlowOptions | None = None) -> PowerFlowResult:
    return solve_fdpf(case, options, "XB")


def solve_fdpf_bx(case: PowerCase, options: PowerFlowOptions | None = None) -> PowerFlowResult:
    return solve_fdpf(case, options, "BX")
