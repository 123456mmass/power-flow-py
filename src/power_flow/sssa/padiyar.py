"""Padiyar model-1.1 two-axis machine DAE and small-signal analysis."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping

import numpy as np

from power_flow.contracts import PowerCase, PowerFlowError, PowerFlowOptions
from power_flow.network import prepare_case
from power_flow.pf import solve_newton_raphson
from power_flow.sssa.emf6 import kundur_dq, kundur_network_current


@dataclass(frozen=True, slots=True)
class PadiyarOptions:
    excitation: str = "avr"
    fd_eps: float = 1e-6
    equilibrium_tolerance: float = 1e-10
    newton_max_iterations: int = 100
    stability_tolerance: float = 1e-7

    def __post_init__(self) -> None:
        excitation = self.excitation.strip().lower()
        if excitation not in {"avr", "manual"}:
            raise PowerFlowError("padiyar_excitation", "excitation must be avr or manual.")
        object.__setattr__(self, "excitation", excitation)
        if self.fd_eps <= 0 or self.equilibrium_tolerance <= 0 or self.newton_max_iterations < 1:
            raise PowerFlowError("padiyar_options", "Invalid Padiyar numerical options.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "PadiyarOptions":
        if value is None:
            return cls()
        resolved = dict(value)
        model_value = resolved.pop("model", None)
        if model_value is not None:
            model = str(model_value).lower()
            if model not in {"padiyar_1_1_avr", "padiyar_1_1_manual"}:
                raise PowerFlowError("padiyar_model", "Unknown Padiyar model route.")
            resolved["excitation"] = "manual" if model.endswith("manual") else "avr"
        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(resolved) - allowed)
        if unknown:
            raise PowerFlowError("unknown_padiyar_options", f"Unknown Padiyar options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class PadiyarMachineData:
    ra: np.ndarray; xd: np.ndarray; xdp: np.ndarray; xq: np.ndarray; xqp: np.ndarray
    tpd0: np.ndarray; tpq0: np.ndarray; ka: np.ndarray; ta: np.ndarray
    synchronous_speed: float


@dataclass(frozen=True, slots=True)
class PadiyarUnits:
    bus_indices: np.ndarray; bus_ids: np.ndarray
    inertia: np.ndarray; damping: np.ndarray; identifiers: tuple[str, ...]


@dataclass(slots=True)
class PadiyarDae:
    case: PowerCase; options: PadiyarOptions; machine: PadiyarMachineData
    units: PadiyarUnits; y_network: np.ndarray; x0: np.ndarray; y0: np.ndarray
    field_voltage0: np.ndarray; mechanical_power: np.ndarray; voltage_reference: np.ndarray
    state_names: tuple[str, ...]; equilibrium_iterations: int; pf: Any

    @property
    def num_machines(self) -> int:
        return self.units.bus_indices.size

    @property
    def states_per_machine(self) -> int:
        return 5 if self.options.excitation == "avr" else 4

    def machine_algebraic(self, x: np.ndarray, y: np.ndarray, k: int) -> tuple[float, float, float, float, complex]:
        ns = self.states_per_machine; offset = ns * k; delta = x[offset]
        eqp, edp = x[offset + 2], x[offset + 3]; bus = self.units.bus_indices[k]
        voltage = complex(y[2 * bus], y[2 * bus + 1]); vd, vq = kundur_dq(voltage, delta)
        m = self.machine; rd, rq = vd - edp, vq - eqp
        denominator = m.ra[k] ** 2 + m.xdp[k] * m.xqp[k]
        current_d = (-m.ra[k] * rd - m.xqp[k] * rq) / denominator
        current_q = (m.xdp[k] * rd - m.ra[k] * rq) / denominator
        return float(current_d), float(current_q), float(vd), float(vq), voltage

    def differential(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        derivative = np.zeros_like(x); ns = self.states_per_machine; m = self.machine
        for k in range(self.num_machines):
            offset = ns * k
            current_d, current_q, vd, vq, voltage = self.machine_algebraic(x, y, k)
            omega, eqp, edp = x[offset + 1 : offset + 4]
            efd = x[offset + 4] if ns == 5 else self.field_voltage0[k]
            torque = vd * current_d + vq * current_q + m.ra[k] * (current_d**2 + current_q**2)
            derivative[offset] = m.synchronous_speed * (omega - 1)
            derivative[offset + 1] = (
                self.mechanical_power[k] - torque - self.units.damping[k] * (omega - 1)
            ) / (2 * self.units.inertia[k])
            derivative[offset + 2] = (efd - eqp - (m.xd[k] - m.xdp[k]) * current_d) / m.tpd0[k]
            derivative[offset + 3] = (-edp + (m.xq[k] - m.xqp[k]) * current_q) / m.tpq0[k]
            if ns == 5:
                derivative[offset + 4] = (
                    m.ka[k] * (self.voltage_reference[k] - abs(voltage)) - efd
                ) / m.ta[k]
        return derivative

    def network(self, x: np.ndarray, y: np.ndarray, matrix: np.ndarray | None = None) -> np.ndarray:
        voltage = y[0::2] + 1j * y[1::2]
        residual_complex = -(self.y_network if matrix is None else matrix) @ voltage
        ns = self.states_per_machine
        for k in range(self.num_machines):
            current_d, current_q, _, _, _ = self.machine_algebraic(x, y, k)
            residual_complex[self.units.bus_indices[k]] += kundur_network_current(current_d, current_q, x[ns * k])
        residual = np.empty(y.size); residual[0::2] = residual_complex.real; residual[1::2] = residual_complex.imag
        return residual

    def electrical_power(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        result = np.zeros(self.num_machines)
        for k in range(self.num_machines):
            current_d, current_q, vd, vq, _ = self.machine_algebraic(x, y, k)
            result[k] = vd * current_d + vq * current_q + self.machine.ra[k] * (current_d**2 + current_q**2)
        return result

    def reactive_power(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        result = np.zeros(self.num_machines); ns = self.states_per_machine
        for k in range(self.num_machines):
            current_d, current_q, _, _, voltage = self.machine_algebraic(x, y, k)
            current = kundur_network_current(current_d, current_q, x[ns * k])
            result[k] = np.imag(voltage * np.conj(current))
        return result


@dataclass(frozen=True, slots=True)
class PadiyarSssaResult:
    system_name: str; model: str; excitation: str; state_names: tuple[str, ...]
    generator_bus_ids: np.ndarray; x0: np.ndarray; y0: np.ndarray
    jxx: np.ndarray; jxy: np.ndarray; jyx: np.ndarray; jyy: np.ndarray; a_full: np.ndarray
    eigenvalues: np.ndarray; frequency_hz: np.ndarray; damping_ratio: np.ndarray
    newton_iterations: int; newton_residual: float; angle_shift_residual: float
    stability_status: str; root_counts: Mapping[str, int]; dae: PadiyarDae

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name, "analysis": "sssa", "model": self.model,
            "excitation": self.excitation, "states": len(self.state_names),
            "stability_status": self.stability_status, "root_counts": dict(self.root_counts),
            "newton_residual": self.newton_residual,
        }


def _expand(value: Any, count: int) -> np.ndarray:
    array = np.asarray(value, dtype=float).reshape(-1)
    if array.size == 1:
        array = np.full(count, array.item())
    if array.size != count or not np.all(np.isfinite(array)):
        raise PowerFlowError("padiyar_machine_data", "Padiyar parameter length or value is invalid.")
    return array


def _scalar_newton(function: Callable[[float], float], seed: float, opt: PadiyarOptions) -> tuple[float, int]:
    value = float(seed)
    for iteration in range(opt.newton_max_iterations + 1):
        residual = float(function(value))
        if abs(residual) <= opt.equilibrium_tolerance:
            return value, iteration
        h = opt.fd_eps * (1 + abs(value)); jacobian = (function(value + h) - function(value - h)) / (2 * h)
        if not np.isfinite(jacobian) or abs(jacobian) < 1e-13:
            raise PowerFlowError("padiyar_angle_jacobian", "Padiyar angle initialization is singular.")
        step = -residual / jacobian; alpha = 1.0
        while alpha >= 2**-16:
            trial = value + alpha * step
            if np.isfinite(function(trial)) and abs(function(trial)) < abs(residual):
                value = trial; break
            alpha *= 0.5
        else:
            raise PowerFlowError("padiyar_angle_line_search", "Padiyar angle initialization failed.")
    raise PowerFlowError("padiyar_angle_iterations", "Padiyar angle initialization exceeded its limit.")


def build_padiyar_dae(case: PowerCase, options: PadiyarOptions | Mapping[str, Any] | None = None) -> PadiyarDae:
    opt = options if isinstance(options, PadiyarOptions) else PadiyarOptions.from_mapping(options)
    raw = case.dynamic_data.get("machines", {}); units_raw = raw.get("units", [])
    if isinstance(units_raw, dict): units_raw = [units_raw]
    if not units_raw or not {"reactances", "time_constants", "exciter"}.issubset(raw):
        raise PowerFlowError("padiyar_machine_data", "Case does not provide Padiyar model-1.1 data.")
    count = len(units_raw); reactance = raw["reactances"]; constants = raw["time_constants"]; exciter = raw["exciter"]
    machine = PadiyarMachineData(
        _expand(reactance["Ra"], count), _expand(reactance["Xd"], count),
        _expand(reactance["Xdp"], count), _expand(reactance["Xq"], count),
        _expand(reactance["Xqp"], count), _expand(constants["Tpd0"], count),
        _expand(constants["Tpq0"], count), _expand(exciter["KA"], count),
        _expand(exciter["TA"], count), 2 * np.pi * case.base_values.frequency_hz,
    )
    model = prepare_case(case); by_id = {int(bus): k for k, bus in enumerate(model.external_bus_ids)}
    units = PadiyarUnits(
        np.asarray([by_id[int(unit["bus"])] for unit in units_raw], dtype=np.int64),
        np.asarray([int(unit["bus"]) for unit in units_raw], dtype=np.int64),
        np.asarray([float(unit["H"]) for unit in units_raw]),
        np.asarray([float(unit["D"]) for unit in units_raw]),
        tuple(str(unit["gen_id"]) for unit in units_raw),
    )
    pf = solve_newton_raphson(case, PowerFlowOptions(max_iter=100, tolerance=opt.equilibrium_tolerance, enforce_q_limits=False))
    if not pf.converged:
        raise PowerFlowError("padiyar_power_flow", "Power flow did not converge for Padiyar DAE.")
    y_network = np.zeros_like(model.ybus)
    for row, start, end in zip(case.line_data, model.line_from_indices, model.line_to_indices, strict=True):
        series = 1 / complex(row[2], row[3]); charging = 1j * row[4]
        y_network[start, start] += series + charging; y_network[end, end] += series + charging
        y_network[start, end] -= series; y_network[end, start] -= series
    y_network[np.diag_indices_from(y_network)] += model.g_shunt + 1j * model.b_shunt
    y_network[np.diag_indices_from(y_network)] += (model.p_load - 1j * model.q_load) / pf.bus_voltage**2
    voltage = pf.bus_voltage * np.exp(1j * pf.bus_angle); y0 = np.empty(2 * model.num_buses)
    y0[0::2] = voltage.real; y0[1::2] = voltage.imag
    ns = 5 if opt.excitation == "avr" else 4; x0 = np.zeros(ns * count)
    efd0 = np.zeros(count); pm = np.zeros(count); vref = np.zeros(count); names: list[str] = []; iterations = 0
    placeholder = PadiyarDae(case, opt, machine, units, y_network, x0, y0, efd0, pm, vref, (), 0, pf)
    for k, bus in enumerate(units.bus_indices):
        terminal_voltage = voltage[bus]; terminal_power = complex(pf.p_generation[bus], pf.q_generation[bus])
        terminal_current = np.conj(terminal_power / terminal_voltage)
        seed = np.angle(terminal_voltage + (machine.ra[k] + 1j * machine.xq[k]) * terminal_current)
        def angle_residual(delta: float) -> float:
            current_d, current_q = kundur_dq(terminal_current, delta); voltage_d, _ = kundur_dq(terminal_voltage, delta)
            return voltage_d + machine.ra[k] * current_d - machine.xq[k] * current_q
        delta, used = _scalar_newton(angle_residual, seed, opt); iterations += used
        current_d, current_q = kundur_dq(terminal_current, delta); voltage_d, voltage_q = kundur_dq(terminal_voltage, delta)
        edp = (machine.xq[k] - machine.xqp[k]) * current_q
        eqp = voltage_q + machine.ra[k] * current_q + machine.xdp[k] * current_d
        efd0[k] = eqp + (machine.xd[k] - machine.xdp[k]) * current_d
        pm[k] = voltage_d * current_d + voltage_q * current_q + machine.ra[k] * (current_d**2 + current_q**2)
        vref[k] = abs(terminal_voltage) + efd0[k] / machine.ka[k]
        state = [delta, 1.0, eqp, edp] + ([efd0[k]] if ns == 5 else [])
        x0[ns * k : ns * (k + 1)] = state; identifier = units.identifiers[k]
        names.extend([f"delta_{identifier}", f"omega_{identifier}", f"Eqp_{identifier}", f"Edp_{identifier}"] + ([f"Efd_{identifier}"] if ns == 5 else []))
    placeholder.state_names = tuple(names); placeholder.equilibrium_iterations = iterations
    return placeholder


def _jacobians(dae: PadiyarDae) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x, y, h = dae.x0, dae.y0, dae.options.fd_eps; nx, ny = x.size, y.size
    jxx = np.zeros((nx, nx)); jxy = np.zeros((nx, ny)); jyx = np.zeros((ny, nx)); jyy = np.zeros((ny, ny))
    for column in range(nx):
        plus = np.array(x, copy=True); minus = np.array(x, copy=True); plus[column] += h; minus[column] -= h
        jxx[:, column] = (dae.differential(plus, y) - dae.differential(minus, y)) / (2 * h)
        jyx[:, column] = (dae.network(plus, y) - dae.network(minus, y)) / (2 * h)
    for column in range(ny):
        plus = np.array(y, copy=True); minus = np.array(y, copy=True); plus[column] += h; minus[column] -= h
        jxy[:, column] = (dae.differential(x, plus) - dae.differential(x, minus)) / (2 * h)
        jyy[:, column] = (dae.network(x, plus) - dae.network(x, minus)) / (2 * h)
    return jxx, jxy, jyx, jyy


def solve_padiyar_sssa(case: PowerCase, options: PadiyarOptions | Mapping[str, Any] | None = None) -> PadiyarSssaResult:
    dae = build_padiyar_dae(case, options)
    residual = max(float(np.max(np.abs(dae.differential(dae.x0, dae.y0)))), float(np.max(np.abs(dae.network(dae.x0, dae.y0)))))
    if residual > 100 * dae.options.equilibrium_tolerance:
        raise PowerFlowError("padiyar_equilibrium", "Padiyar equilibrium residual exceeds tolerance.")
    jxx, jxy, jyx, jyy = _jacobians(dae); a_full = jxx - jxy @ np.linalg.solve(jyy, jyx)
    eigenvalues = np.linalg.eigvals(a_full); real = eigenvalues.real; tolerance = dae.options.stability_tolerance
    unstable = int(np.count_nonzero(real > tolerance)); stable = int(np.count_nonzero(real < -tolerance)); marginal = int(real.size - unstable - stable)
    status = "UNSTABLE" if unstable else ("MARGINAL" if marginal else "ASYMPTOTICALLY STABLE")
    magnitude = np.abs(eigenvalues); damping = np.divide(-real, magnitude, out=np.zeros_like(real), where=magnitude > 0)
    shift = np.zeros(dae.x0.size); shift[0::dae.states_per_machine] = 1
    return PadiyarSssaResult(
        case.system_name, f"padiyar_1_1_{dae.options.excitation}", dae.options.excitation,
        dae.state_names, np.array(dae.units.bus_ids, copy=True), np.array(dae.x0, copy=True),
        np.array(dae.y0, copy=True), jxx, jxy, jyx, jyy, a_full, eigenvalues,
        np.abs(eigenvalues.imag) / (2 * np.pi), damping, dae.equilibrium_iterations,
        residual, float(np.max(np.abs(a_full @ shift))), status,
        MappingProxyType({"unstable": unstable, "stable": stable, "marginal": marginal}), dae,
    )
