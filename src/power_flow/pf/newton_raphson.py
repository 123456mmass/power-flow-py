"""Project-owned Newton-Raphson AC power-flow solver."""

from __future__ import annotations

from dataclasses import replace
from types import MappingProxyType

import numpy as np

from power_flow.contracts import (
    PowerCase,
    PowerFlowOptions,
    PowerFlowResult,
    QLimitEvent,
)
from power_flow.network import (
    PowerFlowModel,
    build_jacobian,
    calculate_line_flows,
    calculate_mismatch,
    calculate_power_injections,
    initial_state,
    prepare_case,
    state_to_voltage_angle,
)


RCOND_THRESHOLD = 1e-13


def _finite_status(value: np.ndarray) -> str:
    bad = np.flatnonzero(~np.isfinite(value))
    return "all_finite" if bad.size == 0 else f"nonfinite_at_index_{int(bad[0]) + 1}"


def _reciprocal_condition(matrix: np.ndarray) -> float:
    try:
        condition = float(np.linalg.cond(matrix, p=1))
    except np.linalg.LinAlgError:
        return 0.0
    return 0.0 if not np.isfinite(condition) or condition == 0 else 1.0 / condition


def _build_result(
    model: PowerFlowModel,
    state: np.ndarray,
    mismatch_history: list[float],
    converged: bool,
    reason: str,
    finite_status: str,
    max_mismatch: float,
) -> PowerFlowResult:
    angle, voltage = state_to_voltage_angle(state, model)
    p_injection, q_injection = calculate_power_injections(voltage, angle, model.ybus)
    p_generation = np.array(model.p_gen, copy=True)
    q_generation = np.array(model.q_gen, copy=True)
    generator_buses = np.concatenate((model.ref, model.pv))
    p_generation[generator_buses] = p_injection[generator_buses] + model.p_load[generator_buses]
    q_generation[generator_buses] = q_injection[generator_buses] + model.q_load[generator_buses]
    p_flow, q_flow, p_loss, q_loss = calculate_line_flows(model, voltage, angle)

    return PowerFlowResult(
        system_name=model.case.system_name,
        method="Newton-Raphson",
        converged=converged,
        reason=reason,
        finite_status=finite_status,
        iterations=len(mismatch_history),
        max_mismatch=float(max_mismatch),
        mismatch_history=np.asarray(mismatch_history, dtype=np.float64),
        external_bus_ids=np.array(model.external_bus_ids, copy=True),
        bus_type=np.array(model.bus_type, copy=True),
        bus_voltage=voltage,
        bus_angle=angle,
        bus_angle_deg=np.rad2deg(angle),
        p_generation=p_generation,
        q_generation=q_generation,
        p_injection=p_injection,
        q_injection=q_injection,
        p_load=np.array(model.p_load, copy=True),
        q_load=np.array(model.q_load, copy=True),
        line_endpoints=model.case.line_data[:, :2].astype(np.int64),
        line_flow_p=p_flow,
        line_flow_q=q_flow,
        line_loss_p=p_loss,
        line_loss_q=q_loss,
        p_loss_total=float(np.sum(p_loss)),
        q_loss_total=float(np.sum(q_loss)),
        p_total_gen=float(np.sum(p_generation)),
        q_total_gen=float(np.sum(q_generation)),
        p_total_load=float(np.sum(model.p_load)),
        q_total_load=float(np.sum(model.q_load)),
        ybus=np.array(model.ybus, copy=True),
        q_limit_events=(),
        q_limit_rounds=0,
        metadata=MappingProxyType(
            {
                "num_buses": model.num_buses,
                "num_lines": model.num_lines,
                "ref_bus_ids": model.external_bus_ids[model.ref].tolist(),
                "pv_bus_ids": model.external_bus_ids[model.pv].tolist(),
                "pq_bus_ids": model.external_bus_ids[model.pq].tolist(),
            }
        ),
    )


def _solve_model(model: PowerFlowModel, options: PowerFlowOptions) -> PowerFlowResult:
    state = initial_state(model)
    mismatch_history: list[float] = []
    max_mismatch = np.inf

    for _ in range(options.max_iter):
        mismatch, p_calc, q_calc, voltage, angle = calculate_mismatch(state, model)
        max_mismatch = float(np.max(np.abs(mismatch))) if mismatch.size else 0.0
        mismatch_history.append(max_mismatch)

        if not np.all(np.isfinite(mismatch)):
            return _build_result(
                model,
                state,
                mismatch_history,
                False,
                "nonfinite_system",
                _finite_status(mismatch),
                max_mismatch,
            )
        if max_mismatch < options.tolerance:
            return _build_result(
                model,
                state,
                mismatch_history,
                True,
                "converged",
                "all_finite",
                max_mismatch,
            )

        jacobian = build_jacobian(voltage, angle, p_calc, q_calc, model)
        if not np.all(np.isfinite(jacobian)):
            return _build_result(
                model,
                state,
                mismatch_history,
                False,
                "nonfinite_system",
                "nonfinite_jacobian",
                max_mismatch,
            )

        rcond = _reciprocal_condition(jacobian)
        if not np.isfinite(rcond) or rcond < RCOND_THRESHOLD:
            return _build_result(
                model,
                state,
                mismatch_history,
                False,
                "singular_jacobian",
                f"rcond_{rcond:.2e}",
                max_mismatch,
            )

        try:
            step = np.linalg.solve(jacobian, mismatch)
        except np.linalg.LinAlgError:
            return _build_result(
                model,
                state,
                mismatch_history,
                False,
                "singular_jacobian",
                "rcond_0.00e+00",
                max_mismatch,
            )
        if not np.all(np.isfinite(step)):
            return _build_result(
                model,
                state,
                mismatch_history,
                False,
                "nonfinite_newton_step",
                _finite_status(step),
                max_mismatch,
            )

        state = state + step
        if not np.all(np.isfinite(state)):
            return _build_result(
                model,
                state,
                mismatch_history,
                False,
                "nonfinite_state",
                _finite_status(state),
                max_mismatch,
            )
        voltage_state = state[model.num_delta :]
        voltage_state[voltage_state <= 0] = 0.1

    return _build_result(
        model,
        state,
        mismatch_history,
        False,
        "max_iterations",
        _finite_status(state),
        max_mismatch,
    )


def _q_limit_violations(
    model: PowerFlowModel,
    result: PowerFlowResult,
    tolerance: float,
) -> list[tuple[int, float, str]]:
    violations: list[tuple[int, float, str]] = []
    for bus_index in model.pv:
        q_generation = result.q_generation[bus_index]
        if np.isfinite(model.q_max[bus_index]) and q_generation > model.q_max[bus_index] + tolerance:
            violations.append((int(bus_index), float(model.q_max[bus_index]), "Qmax"))
        elif np.isfinite(model.q_min[bus_index]) and q_generation < model.q_min[bus_index] - tolerance:
            violations.append((int(bus_index), float(model.q_min[bus_index]), "Qmin"))
    return violations


def solve_newton_raphson(
    case: PowerCase,
    options: PowerFlowOptions | None = None,
) -> PowerFlowResult:
    """Solve a power case with the audited in-house Newton-Raphson algorithm."""

    resolved_options = PowerFlowOptions() if options is None else options
    working_case = case
    events: list[QLimitEvent] = []
    switch_round = 0

    while True:
        model = prepare_case(working_case)
        result = _solve_model(model, resolved_options)
        if (
            not result.converged
            or not resolved_options.enforce_q_limits
            or switch_round >= resolved_options.max_q_limit_switches
        ):
            break
        violations = _q_limit_violations(model, result, resolved_options.q_limit_tolerance)
        if not violations:
            break

        switch_round += 1
        bus_data = np.array(model.case.bus_data, copy=True)
        bus_data[:, 2] = result.bus_voltage
        bus_data[:, 3] = result.bus_angle_deg
        for bus_index, fixed_q, limit_type in violations:
            events.append(
                QLimitEvent(
                    round=switch_round,
                    bus_id=int(model.external_bus_ids[bus_index]),
                    from_type="PV",
                    to_type="PQ",
                    q_generation_before=float(result.q_generation[bus_index]),
                    q_fixed=fixed_q,
                    limit_type=limit_type,
                )
            )
            bus_data[bus_index, 1] = 3
            bus_data[bus_index, 5] = fixed_q
        working_case = model.case.with_bus_data(bus_data)

    return replace(result, q_limit_events=tuple(events), q_limit_rounds=switch_round)
