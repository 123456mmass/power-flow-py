"""Shared result and reactive-limit contracts for project-owned PF methods."""

from __future__ import annotations

from dataclasses import replace
from types import MappingProxyType
from typing import Callable

import numpy as np

from power_flow.contracts import PowerCase, PowerFlowOptions, PowerFlowResult, QLimitEvent
from power_flow.network import (
    PowerFlowModel,
    calculate_line_flows,
    calculate_power_injections,
    prepare_case,
)


def full_mismatch(model: PowerFlowModel, voltage: np.ndarray, angle: np.ndarray) -> np.ndarray:
    p_calc, q_calc = calculate_power_injections(voltage, angle, model.ybus)
    return np.concatenate((
        model.p_net[model.delta_indices] - p_calc[model.delta_indices],
        model.q_net[model.voltage_indices] - q_calc[model.voltage_indices],
    ))


def build_result(
    model: PowerFlowModel,
    voltage: np.ndarray,
    angle: np.ndarray,
    mismatch_history: list[float],
    converged: bool,
    reason: str,
    finite_status: str,
    method: str,
    metadata: dict[str, object] | None = None,
) -> PowerFlowResult:
    p_injection, q_injection = calculate_power_injections(voltage, angle, model.ybus)
    p_generation = np.array(model.p_gen, copy=True)
    q_generation = np.array(model.q_gen, copy=True)
    generator_buses = np.concatenate((model.ref, model.pv))
    p_generation[generator_buses] = p_injection[generator_buses] + model.p_load[generator_buses]
    q_generation[generator_buses] = q_injection[generator_buses] + model.q_load[generator_buses]
    p_flow, q_flow, p_loss, q_loss = calculate_line_flows(model, voltage, angle)
    maximum = mismatch_history[-1] if mismatch_history else 0.0
    details: dict[str, object] = {
        "num_buses": model.num_buses,
        "num_lines": model.num_lines,
        "ref_bus_ids": model.external_bus_ids[model.ref].tolist(),
        "pv_bus_ids": model.external_bus_ids[model.pv].tolist(),
        "pq_bus_ids": model.external_bus_ids[model.pq].tolist(),
        "method_requested": method,
        "method_executed": method,
        "capability": "production",
        "fallback_used": False,
        "full_ac_mismatch": float(maximum),
    }
    if metadata:
        details.update(metadata)
    return PowerFlowResult(
        system_name=model.case.system_name, method=method, converged=converged,
        reason=reason, finite_status=finite_status, iterations=len(mismatch_history),
        max_mismatch=float(maximum), mismatch_history=np.asarray(mismatch_history),
        external_bus_ids=np.array(model.external_bus_ids, copy=True),
        bus_type=np.array(model.bus_type, copy=True), bus_voltage=np.asarray(voltage),
        bus_angle=np.asarray(angle), bus_angle_deg=np.rad2deg(angle),
        p_generation=p_generation, q_generation=q_generation,
        p_injection=p_injection, q_injection=q_injection,
        p_load=np.array(model.p_load, copy=True), q_load=np.array(model.q_load, copy=True),
        line_endpoints=model.case.line_data[:, :2].astype(np.int64),
        line_flow_p=p_flow, line_flow_q=q_flow, line_loss_p=p_loss, line_loss_q=q_loss,
        p_loss_total=float(p_loss.sum()), q_loss_total=float(q_loss.sum()),
        p_total_gen=float(p_generation.sum()), q_total_gen=float(q_generation.sum()),
        p_total_load=float(model.p_load.sum()), q_total_load=float(model.q_load.sum()),
        ybus=np.array(model.ybus, copy=True), q_limit_events=(), q_limit_rounds=0,
        metadata=MappingProxyType(details),
    )


def solve_with_q_limits(
    case: PowerCase,
    options: PowerFlowOptions,
    solve_round: Callable[[PowerCase, PowerFlowOptions], PowerFlowResult],
) -> PowerFlowResult:
    """Apply the shared PV-to-PQ limit-switch loop around one solver round."""
    working_case = case
    events: list[QLimitEvent] = []
    rounds = 0
    round_options = replace(options, enforce_q_limits=False)
    while True:
        model = prepare_case(working_case)
        result = solve_round(working_case, round_options)
        if not result.converged or not options.enforce_q_limits or rounds >= options.max_q_limit_switches:
            break
        violations: list[tuple[int, float, str]] = []
        for bus in model.pv:
            generated = result.q_generation[bus]
            if np.isfinite(model.q_max[bus]) and generated > model.q_max[bus] + options.q_limit_tolerance:
                violations.append((int(bus), float(model.q_max[bus]), "Qmax"))
            elif np.isfinite(model.q_min[bus]) and generated < model.q_min[bus] - options.q_limit_tolerance:
                violations.append((int(bus), float(model.q_min[bus]), "Qmin"))
        if not violations:
            break
        rounds += 1
        buses = np.array(model.case.bus_data, copy=True)
        buses[:, 2] = result.bus_voltage
        buses[:, 3] = result.bus_angle_deg
        for bus, fixed_q, limit_type in violations:
            events.append(QLimitEvent(
                round=rounds, bus_id=int(model.external_bus_ids[bus]), from_type="PV", to_type="PQ",
                q_generation_before=float(result.q_generation[bus]), q_fixed=fixed_q,
                limit_type=limit_type,
            ))
            buses[bus, 1] = 3
            buses[bus, 5] = fixed_q
        working_case = model.case.with_bus_data(buses)
    return replace(result, q_limit_events=tuple(events), q_limit_rounds=rounds)
