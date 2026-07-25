"""Fixed-step transient simulation of the project classical machine model."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np
from numpy.typing import NDArray
from scipy.linalg import lu_factor, lu_solve

from power_flow.contracts import FloatArray, PowerCase, PowerFlowError, PowerFlowOptions
from power_flow.network import prepare_case
from power_flow.pf import solve_newton_raphson
from power_flow.sssa.classical import SssaOptions, _machine_parameters


@dataclass(frozen=True, slots=True)
class TsOptions:
    model: str = "classical"
    t_end: float = 15.0
    dt: float = 0.01
    fault_bus: int | None = None
    t_fault: float = 1.0
    t_clear: float = 1.1
    fault_impedance: complex = 0.1j
    fault_enabled: bool = True
    integrator: str = "trapezoidal"
    corrector_mode: str = "adaptive"
    corrector_iter: int = 10
    corrector_abs_tol: float = 1e-10
    corrector_rel_tol: float = 1e-8
    max_corrector_iter: int = 10
    corrector_failure: str = "error"
    pm_mode: str = "balanced"
    be_newton_tol: float = 1e-10
    be_max_iter: int = 30
    h: Any = None
    d: Any = None
    xdp: Any = None

    def __post_init__(self) -> None:
        if self.model.strip().lower() != "classical":
            raise PowerFlowError("ts_model_not_implemented", "Only classical TS is implemented.")
        object.__setattr__(self, "model", "classical")
        integrator = self.integrator.strip().lower()
        aliases = {"be": "backward_euler", "backward-euler": "backward_euler",
                   "trap": "trapezoidal"}
        integrator = aliases.get(integrator, integrator)
        if integrator not in {"trapezoidal", "rk4", "backward_euler"}:
            raise PowerFlowError("ts_integrator", "Unknown TS integrator.")
        object.__setattr__(self, "integrator", integrator)
        mode = self.corrector_mode.strip().lower()
        if mode not in {"adaptive", "fixed"}:
            raise PowerFlowError("ts_corrector_mode", "corrector_mode must be adaptive or fixed.")
        object.__setattr__(self, "corrector_mode", mode)
        pm_mode = self.pm_mode.strip().lower()
        if pm_mode not in {"balanced", "pe0", "pfpg", "pgaz", "pg"}:
            raise PowerFlowError("ts_pm_mode", "Unknown mechanical-power mode.")
        object.__setattr__(self, "pm_mode", pm_mode)
        failure = self.corrector_failure.strip().lower()
        if failure not in {"error", "continue"}:
            raise PowerFlowError("ts_corrector_failure", "corrector_failure must be error or continue.")
        object.__setattr__(self, "corrector_failure", failure)
        if not np.isfinite(self.dt) or self.dt <= 0 or not np.isfinite(self.t_end) or self.t_end < 0:
            raise PowerFlowError("ts_time", "dt must be positive and t_end non-negative.")
        if self.corrector_iter < 1 or self.max_corrector_iter < 1 or self.be_max_iter < 1:
            raise PowerFlowError("ts_iterations", "TS iteration limits must be positive.")
        if self.fault_enabled and (not np.isfinite(self.fault_impedance) or self.fault_impedance == 0):
            raise PowerFlowError("ts_fault_impedance", "Fault impedance must be finite and non-zero.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "TsOptions":
        if value is None:
            return cls()
        aliases = {
            "method": "integrator", "Zf": "fault_impedance", "H": "h", "D": "d",
            "Xdp": "xdp", "corrector_iterations": "corrector_iter",
        }
        resolved = {aliases.get(key, key): item for key, item in value.items()}
        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(resolved) - allowed)
        if unknown:
            raise PowerFlowError("unknown_ts_options", f"Unknown TS options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class TsResult:
    system_name: str
    model: str
    integrator: str
    time: FloatArray
    delta: FloatArray
    omega: FloatArray
    electrical_power: FloatArray
    bus_voltage: FloatArray
    generator_bus_ids: NDArray[np.int64]
    inertia: FloatArray
    machine_damping: FloatArray
    transient_reactance: FloatArray
    mechanical_power: FloatArray
    internal_voltage_magnitude: FloatArray
    corrector_iterations: NDArray[np.int64]
    corrector_residual: FloatArray
    corrector_converged: NDArray[np.bool_]
    event_indices: NDArray[np.int64]
    event_side: NDArray[np.int64]
    nonconverged_step_count: int
    metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name, "analysis": "ts", "model": self.model,
            "integrator": self.integrator, "steps": int(self.time.size - 1),
            "generators": int(self.generator_bus_ids.size),
            "nonconverged_step_count": self.nonconverged_step_count,
            "max_speed_deviation": float(np.max(np.abs(self.omega - 1.0))),
        }


@dataclass(slots=True)
class _Step:
    state: np.ndarray
    iterations: int
    residual: float
    converged: bool


class _Network:
    def __init__(self, ynet: np.ndarray, generator_indices: np.ndarray,
                 reactance: np.ndarray, internal_magnitude: np.ndarray) -> None:
        self.generator_indices = generator_indices
        self.reactance = reactance
        self.internal_magnitude = internal_magnitude
        matrix = np.array(ynet, copy=True)
        for bus, value in zip(generator_indices, reactance, strict=True):
            matrix[bus, bus] += 1.0 / (1j * value)
        self.factor = lu_factor(matrix)
        self.num_buses = matrix.shape[0]

    def solve(self, delta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        internal = self.internal_magnitude * np.exp(1j * delta)
        injection = np.zeros(self.num_buses, dtype=np.complex128)
        for bus, reactance, voltage in zip(
            self.generator_indices, self.reactance, internal, strict=True
        ):
            injection[bus] += voltage / (1j * reactance)
        bus_voltage = lu_solve(self.factor, injection)
        current = (internal - bus_voltage[self.generator_indices]) / (1j * self.reactance)
        power = np.real(bus_voltage[self.generator_indices] * np.conj(current))
        return bus_voltage, power


def _trapezoidal_step(state: np.ndarray, step_size: float, rhs, opt: TsOptions) -> _Step:
    f0 = rhs(state)
    candidate = state + step_size * f0
    iterations = opt.corrector_iter if opt.corrector_mode == "fixed" else opt.max_corrector_iter
    converged = False; residual = np.inf
    for iteration in range(1, iterations + 1):
        updated = state + 0.5 * step_size * (f0 + rhs(candidate))
        equation_residual = updated - state - 0.5 * step_size * (f0 + rhs(updated))
        update_norm = float(np.max(np.abs(updated - candidate)))
        residual = float(np.max(np.abs(equation_residual)))
        candidate = updated
        if opt.corrector_mode == "adaptive":
            tolerance = opt.corrector_abs_tol + opt.corrector_rel_tol * max(
                1.0, float(np.max(np.abs(candidate)))
            )
            if update_norm <= tolerance and residual <= tolerance:
                converged = True
                break
    if opt.corrector_mode == "fixed":
        residual = float(np.max(np.abs(
            candidate - state - 0.5 * step_size * (f0 + rhs(candidate))
        )))
        converged = residual <= 1e-6
    return _Step(candidate, iteration, residual, converged)


def _rk4_step(state: np.ndarray, step_size: float, rhs) -> _Step:
    k1 = rhs(state); k2 = rhs(state + 0.5 * step_size * k1)
    k3 = rhs(state + 0.5 * step_size * k2); k4 = rhs(state + step_size * k3)
    updated = state + step_size / 6.0 * (k1 + 2 * k2 + 2 * k3 + k4)
    finite = bool(np.all(np.isfinite(updated)))
    return _Step(updated, 4, 0.0, finite)


def _backward_euler_step(state: np.ndarray, step_size: float, rhs, opt: TsOptions) -> _Step:
    candidate = state + step_size * rhs(state)
    residual_norm = np.inf; update_norm = np.inf; converged = False
    for iteration in range(1, opt.be_max_iter + 1):
        residual = candidate - state - step_size * rhs(candidate)
        residual_norm = float(np.max(np.abs(residual)))
        if residual_norm <= opt.be_newton_tol:
            converged = True
            break
        jacobian = np.zeros((state.size, state.size))
        for column in range(state.size):
            increment = 6e-6 * (1.0 + abs(candidate[column]))
            plus = np.array(candidate, copy=True); minus = np.array(candidate, copy=True)
            plus[column] += increment; minus[column] -= increment
            jacobian[:, column] = (rhs(plus) - rhs(minus)) / (2 * increment)
        solve_matrix = np.eye(state.size) - step_size * jacobian
        if 1.0 / np.linalg.cond(solve_matrix, p=1) < 1e-13:
            raise PowerFlowError("ts_be_singular", "Backward-Euler Jacobian is singular.")
        correction = np.linalg.solve(solve_matrix, -residual)
        update_norm = float(np.max(np.abs(correction)))
        alpha = 1.0
        while alpha >= 2**-16:
            trial = candidate + alpha * correction
            trial_residual = trial - state - step_size * rhs(trial)
            if np.all(np.isfinite(trial_residual)) and np.max(np.abs(trial_residual)) < residual_norm:
                candidate = trial
                break
            alpha *= 0.5
        else:
            raise PowerFlowError("ts_be_line_search", "Backward-Euler line search failed.")
    return _Step(candidate, iteration, residual_norm, converged)


def _time_grid(opt: TsOptions) -> np.ndarray:
    count = int(np.floor(opt.t_end / opt.dt + 1e-12))
    time = np.arange(count + 1, dtype=np.float64) * opt.dt
    if time[-1] < opt.t_end - opt.dt * 1e-10:
        time = np.append(time, opt.t_end)
    elif abs(time[-1] - opt.t_end) <= opt.dt * 1e-10:
        time[-1] = opt.t_end
    for event_time in (opt.t_fault, opt.t_clear):
        if np.isfinite(event_time) and 0 < event_time < opt.t_end:
            nearest = int(np.argmin(np.abs(time - event_time)))
            if abs(time[nearest] - event_time) > opt.dt * 1e-10:
                time = np.sort(np.append(time, event_time))
            else:
                time[nearest] = event_time
    return time


def simulate_classical(
    case: PowerCase, options: TsOptions | Mapping[str, Any] | None = None
) -> TsResult:
    opt = options if isinstance(options, TsOptions) else TsOptions.from_mapping(options)
    model = prepare_case(case)
    pf = solve_newton_raphson(
        case, PowerFlowOptions(max_iter=50, tolerance=1e-10, enforce_q_limits=False)
    )
    if not pf.converged:
        raise PowerFlowError("ts_power_flow", "Power flow did not converge for TS initialization.")
    generator_indices = np.flatnonzero(np.isin(model.bus_type, [1, 2]))
    generator_bus_ids = model.external_bus_ids[generator_indices]
    h, damping, xdp, dynamic_source = _machine_parameters(
        case, generator_bus_ids, SssaOptions(h=opt.h, d=opt.d, xdp=opt.xdp)
    )
    voltage0 = pf.bus_voltage * np.exp(1j * pf.bus_angle)
    ynet = model.ybus + np.diag(
        np.conj(model.p_load + 1j * model.q_load)
        / (np.abs(voltage0) ** 2 + np.finfo(float).eps)
    )
    internal = np.zeros(generator_indices.size, dtype=np.complex128)
    for k, bus in enumerate(generator_indices):
        generation = pf.p_generation[bus] + 1j * pf.q_generation[bus]
        current = np.conj(generation / voltage0[bus])
        internal[k] = voltage0[bus] + 1j * xdp[k] * current
    delta0 = np.angle(internal); internal_magnitude = np.abs(internal)

    fault_bus_id = int(generator_bus_ids[0]) if opt.fault_bus is None else int(opt.fault_bus)
    positions = np.flatnonzero(model.external_bus_ids == fault_bus_id)
    if positions.size != 1:
        raise PowerFlowError("ts_fault_bus", f"Fault bus {fault_bus_id} is not in the case.")
    yfault = np.array(ynet, copy=True)
    if opt.fault_enabled:
        yfault[int(positions[0]), int(positions[0])] += 1.0 / opt.fault_impedance
    networks = {
        "pre": _Network(ynet, generator_indices, xdp, internal_magnitude),
        "fault": _Network(yfault, generator_indices, xdp, internal_magnitude),
    }
    _, initial_power = networks["pre"].solve(delta0)
    if opt.pm_mode in {"balanced", "pe0"}:
        mechanical_power = initial_power
    else:
        mechanical_power = pf.p_generation[generator_indices]
    synchronous_speed = 2 * np.pi * case.base_values.frequency_hz

    def network_at(time: float) -> _Network:
        active = opt.fault_enabled and time >= opt.t_fault and time < opt.t_clear
        return networks["fault" if active else "pre"]

    def rhs_for(network: _Network):
        def rhs(state: np.ndarray) -> np.ndarray:
            _, electrical = network.solve(state[: generator_indices.size])
            speed = state[generator_indices.size :]
            return np.concatenate((
                synchronous_speed * (speed - 1.0),
                (mechanical_power - electrical - damping * (speed - 1.0)) / (2 * h),
            ))
        return rhs

    time = _time_grid(opt); steps = time.size - 1
    delta = np.zeros((time.size, generator_indices.size)); omega = np.zeros_like(delta)
    power = np.zeros_like(delta); bus_voltage = np.zeros((time.size, model.num_buses))
    correction_iterations = np.zeros(steps, dtype=np.int64)
    correction_residual = np.zeros(steps); correction_converged = np.ones(steps, dtype=np.bool_)
    state = np.concatenate((delta0, np.ones(generator_indices.size)))
    delta[0] = delta0; omega[0] = 1.0
    voltage, power[0] = networks["pre"].solve(delta0); bus_voltage[0] = np.abs(voltage)
    for index, step_size in enumerate(np.diff(time)):
        rhs = rhs_for(network_at(float(time[index])))
        if opt.integrator == "trapezoidal":
            step = _trapezoidal_step(state, float(step_size), rhs, opt)
        elif opt.integrator == "rk4":
            step = _rk4_step(state, float(step_size), rhs)
        else:
            step = _backward_euler_step(state, float(step_size), rhs, opt)
        if not np.all(np.isfinite(step.state)):
            raise PowerFlowError("ts_nonfinite", f"Non-finite TS state at step {index + 1}.")
        if not step.converged and opt.corrector_mode == "adaptive" and opt.corrector_failure == "error":
            raise PowerFlowError("ts_corrector", f"TS corrector failed at step {index + 1}.")
        state = step.state
        correction_iterations[index] = step.iterations
        correction_residual[index] = step.residual
        correction_converged[index] = step.converged
        delta[index + 1] = state[: generator_indices.size]
        omega[index + 1] = state[generator_indices.size :]
        voltage, power[index + 1] = network_at(float(time[index + 1])).solve(delta[index + 1])
        bus_voltage[index + 1] = np.abs(voltage)
    event_side = np.zeros(time.size, dtype=np.int64)
    event_indices: list[int] = []
    for event_time in (opt.t_fault, opt.t_clear):
        matches = np.flatnonzero(np.abs(time - event_time) < opt.dt * 1e-10)
        if matches.size:
            event_indices.append(int(matches[0])); event_side[int(matches[0])] = 1
    return TsResult(
        system_name=case.system_name, model="classical", integrator=opt.integrator,
        time=time, delta=delta, omega=omega, electrical_power=power,
        bus_voltage=bus_voltage, generator_bus_ids=np.array(generator_bus_ids, copy=True),
        inertia=h, machine_damping=damping, transient_reactance=xdp,
        mechanical_power=np.array(mechanical_power, copy=True),
        internal_voltage_magnitude=internal_magnitude,
        corrector_iterations=correction_iterations, corrector_residual=correction_residual,
        corrector_converged=correction_converged,
        event_indices=np.asarray(event_indices, dtype=np.int64), event_side=event_side,
        nonconverged_step_count=int(np.count_nonzero(~correction_converged)),
        metadata=MappingProxyType({
            "dynamic_data_source": dynamic_source, "fault_bus": fault_bus_id,
            "t_fault": opt.t_fault, "t_clear": opt.t_clear, "dt": opt.dt,
            "method_source": "project-owned fixed-step integrator",
            "capability": "diagnostic" if opt.integrator == "rk4" else "production",
            "fallback_used": False,
        }),
    )
