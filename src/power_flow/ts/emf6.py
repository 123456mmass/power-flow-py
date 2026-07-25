"""Fixed-step transient simulation of the operational EMF6 DAE."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np

from power_flow.contracts import FloatArray, PowerCase, PowerFlowError
from power_flow.sssa.emf6 import Emf6Dae, Emf6Options, build_emf6_dae


@dataclass(frozen=True, slots=True)
class Emf6TsOptions:
    model: str = "emf6"
    t_end: float = 15.0
    dt: float = 0.01
    fault_bus: int | None = None
    t_fault: float = 1.0
    t_clear: float = 1.1
    fault_impedance: complex = 0.1j
    fault_enabled: bool = True
    integrator: str = "trapezoidal"
    corrector_mode: str = "fixed"
    corrector_iter: int = 3
    algebraic_tolerance: float = 1e-12
    load_model: str = "cc_p_cz_q"

    def __post_init__(self) -> None:
        if self.model.strip().lower() != "emf6":
            raise PowerFlowError("ts_model", "EMF6 TS requires model='emf6'.")
        object.__setattr__(self, "model", "emf6")
        if self.integrator.strip().lower() not in {"trapezoidal", "trap"}:
            raise PowerFlowError("emf6_ts_integrator", "Verified EMF6 TS supports trapezoidal only.")
        object.__setattr__(self, "integrator", "trapezoidal")
        if self.corrector_mode.strip().lower() != "fixed":
            raise PowerFlowError("emf6_ts_corrector", "Verified EMF6 TS requires fixed correctors.")
        object.__setattr__(self, "corrector_mode", "fixed")
        if self.dt <= 0 or self.t_end < 0 or self.corrector_iter < 1:
            raise PowerFlowError("emf6_ts_time", "Invalid EMF6 TS time or iteration option.")
        if self.algebraic_tolerance <= 0:
            raise PowerFlowError("emf6_ts_tolerance", "Algebraic tolerance must be positive.")
        if self.fault_enabled and (not np.isfinite(self.fault_impedance) or self.fault_impedance == 0):
            raise PowerFlowError("emf6_ts_fault", "Fault impedance must be finite and non-zero.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "Emf6TsOptions":
        if value is None:
            return cls()
        aliases = {"method": "integrator", "Zf": "fault_impedance"}
        resolved = {aliases.get(key, key): item for key, item in value.items()}
        unknown = sorted(set(resolved) - set(cls.__dataclass_fields__))
        if unknown:
            raise PowerFlowError("unknown_emf6_ts_options", f"Unknown EMF6 TS options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class Emf6TsResult:
    system_name: str; model: str; integrator: str
    time: FloatArray; delta: FloatArray; omega: FloatArray
    electrical_power: FloatArray; bus_voltage: FloatArray
    generator_bus_ids: np.ndarray; inertia: FloatArray
    machine_damping: FloatArray; mechanical_power: FloatArray
    corrector_iterations: np.ndarray; corrector_residual: FloatArray
    corrector_converged: np.ndarray; algebraic_residual: FloatArray
    event_indices: np.ndarray; event_side: np.ndarray
    nonconverged_step_count: int; initial_dae_residual: float
    metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name, "analysis": "ts", "model": self.model,
            "integrator": self.integrator, "steps": int(self.time.size - 1),
            "generators": int(self.generator_bus_ids.size),
            "nonconverged_step_count": self.nonconverged_step_count,
            "max_speed_deviation": float(np.max(np.abs(self.omega))),
            "max_algebraic_residual": float(np.max(self.algebraic_residual, initial=0.0)),
        }


def _jacobian_y(dae: Emf6Dae, x: np.ndarray, y: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    jacobian = np.zeros((y.size, y.size))
    for column in range(y.size):
        increment = 1e-7 * (1.0 + abs(y[column]))
        plus = np.array(y, copy=True); minus = np.array(y, copy=True)
        plus[column] += increment; minus[column] -= increment
        jacobian[:, column] = (dae.network(x, plus, matrix) - dae.network(x, minus, matrix)) / (2 * increment)
    return jacobian


def _solve_algebraic(
    dae: Emf6Dae, x: np.ndarray, seed: np.ndarray, matrix: np.ndarray,
    tolerance: float, jacobian: np.ndarray | None = None,
) -> tuple[np.ndarray, float]:
    y = np.array(seed, copy=True); current_jacobian = jacobian
    for _ in range(30):
        residual = dae.network(x, y, matrix); norm = float(np.max(np.abs(residual)))
        if norm <= tolerance:
            return y, norm
        if current_jacobian is None:
            current_jacobian = _jacobian_y(dae, x, y, matrix)
        try:
            step = np.linalg.solve(current_jacobian, -residual)
        except np.linalg.LinAlgError as error:
            raise PowerFlowError("emf6_ts_algebraic_singular", "Algebraic Jacobian is singular.") from error
        alpha = 1.0
        while alpha >= 2**-16:
            trial = y + alpha * step; trial_residual = dae.network(x, trial, matrix)
            if np.all(np.isfinite(trial_residual)) and np.max(np.abs(trial_residual)) < norm:
                y = trial; break
            alpha *= 0.5
        else:
            current_jacobian = _jacobian_y(dae, x, y, matrix)
            try:
                step = np.linalg.solve(current_jacobian, -residual)
            except np.linalg.LinAlgError as error:
                raise PowerFlowError("emf6_ts_algebraic_singular", "Algebraic Jacobian is singular.") from error
            trial = y + step
            if np.max(np.abs(dae.network(x, trial, matrix))) >= norm:
                raise PowerFlowError("emf6_ts_algebraic", "Algebraic line search failed.")
            y = trial
    raise PowerFlowError("emf6_ts_algebraic", "Algebraic solve exceeded 30 iterations.")


def _time_grid(opt: Emf6TsOptions) -> np.ndarray:
    count = int(np.floor(opt.t_end / opt.dt + 1e-12)); time = np.arange(count + 1) * opt.dt
    if time[-1] < opt.t_end - opt.dt * 1e-10:
        time = np.append(time, opt.t_end)
    else:
        time[-1] = opt.t_end
    if opt.fault_enabled:
        for event in (opt.t_fault, opt.t_clear):
            if np.isfinite(event) and 0 < event < opt.t_end:
                nearest = int(np.argmin(np.abs(time - event)))
                if abs(time[nearest] - event) <= opt.dt * 1e-10:
                    time[nearest] = event
                else:
                    time = np.sort(np.append(time, event))
    return time.astype(float)


def simulate_emf6(case: PowerCase, options: Emf6TsOptions | Mapping[str, Any] | None = None) -> Emf6TsResult:
    opt = options if isinstance(options, Emf6TsOptions) else Emf6TsOptions.from_mapping(options)
    dae = build_emf6_dae(case, Emf6Options(load_model=opt.load_model))
    fault_bus = int(dae.units.bus_ids[0]) if opt.fault_bus is None else int(opt.fault_bus)
    matches = np.flatnonzero(np.asarray(dae.pf.external_bus_ids) == fault_bus)
    if matches.size != 1:
        raise PowerFlowError("emf6_ts_fault_bus", f"Fault bus {fault_bus} is not in the case.")
    pre = np.array(dae.y_network, copy=True); fault = np.array(pre, copy=True)
    if opt.fault_enabled:
        fault[int(matches[0]), int(matches[0])] += 1.0 / opt.fault_impedance

    def topology(t: float) -> np.ndarray:
        return fault if opt.fault_enabled and t >= opt.t_fault and t < opt.t_clear else pre

    time = _time_grid(opt); steps = time.size - 1; ng = dae.num_machines
    delta = np.zeros((time.size, ng)); omega = np.zeros_like(delta); power = np.zeros_like(delta)
    voltage = np.zeros((time.size, dae.y0.size // 2)); iterations = np.full(steps, opt.corrector_iter, dtype=np.int64)
    correction = np.zeros(steps); converged = np.zeros(steps, dtype=np.bool_); algebraic = np.zeros(steps)
    x = np.array(dae.x0, copy=True); y = np.array(dae.y0, copy=True)
    initial_residual = max(float(np.max(np.abs(dae.differential(x, y)))), float(np.max(np.abs(dae.network(x, y, pre)))))
    delta[0] = x[0::6]; omega[0] = x[1::6]; power[0] = dae.electrical_power(x, y)
    voltage[0] = np.abs(y[0::2] + 1j * y[1::2])
    for index, h in enumerate(np.diff(time)):
        matrix_now = topology(float(time[index])); matrix_next = topology(float(time[index + 1]))
        jacobian = _jacobian_y(dae, x, y, matrix_now)
        y, _ = _solve_algebraic(dae, x, y, matrix_now, opt.algebraic_tolerance, jacobian)
        f0 = dae.differential(x, y); candidate = x + h * f0; y_candidate = y
        for _ in range(opt.corrector_iter):
            y_candidate, _ = _solve_algebraic(dae, candidate, y_candidate, matrix_now, opt.algebraic_tolerance, jacobian)
            candidate = x + 0.5 * h * (f0 + dae.differential(candidate, y_candidate))
        y_candidate, _ = _solve_algebraic(dae, candidate, y_candidate, matrix_now, opt.algebraic_tolerance, jacobian)
        residual = candidate - x - 0.5 * h * (f0 + dae.differential(candidate, y_candidate))
        correction[index] = float(np.max(np.abs(residual))); converged[index] = correction[index] <= 1e-6
        algebraic[index] = float(np.max(np.abs(dae.network(candidate, y_candidate, matrix_now))))
        x = candidate; next_jacobian = _jacobian_y(dae, x, y_candidate, matrix_next)
        y, _ = _solve_algebraic(dae, x, y_candidate, matrix_next, opt.algebraic_tolerance, next_jacobian)
        delta[index + 1] = x[0::6]; omega[index + 1] = x[1::6]
        power[index + 1] = dae.electrical_power(x, y); voltage[index + 1] = np.abs(y[0::2] + 1j * y[1::2])
    event_side = np.zeros(time.size, dtype=np.int64); event_indices: list[int] = []
    if opt.fault_enabled:
        for event in (opt.t_fault, opt.t_clear):
            found = np.flatnonzero(np.abs(time - event) < opt.dt * 1e-10)
            if found.size:
                event_indices.append(int(found[0])); event_side[int(found[0])] = 1
    return Emf6TsResult(
        case.system_name, "emf6", "trapezoidal", time, delta, omega, power, voltage,
        np.array(dae.units.bus_ids, copy=True), np.array(dae.units.inertia, copy=True),
        np.array(dae.units.damping, copy=True), np.array(dae.mechanical_torque, copy=True),
        iterations, correction, converged, algebraic, np.asarray(event_indices, dtype=np.int64), event_side,
        int(np.count_nonzero(~converged)), initial_residual,
        MappingProxyType({"fault_bus": fault_bus, "t_fault": opt.t_fault, "t_clear": opt.t_clear,
                          "dt": opt.dt, "load_model": opt.load_model,
                          "method_source": "project-owned coupled DAE fixed-step integrator",
                          "event_contract": "left topology step; right topology endpoint record",
                          "fallback_used": False}),
    )
