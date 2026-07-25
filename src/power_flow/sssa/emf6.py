"""Operational sixth-order synchronous-machine EMF DAE and SSSA."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping

import numpy as np

from power_flow.contracts import PowerCase, PowerFlowError, PowerFlowOptions
from power_flow.network import prepare_case
from power_flow.pf import solve_newton_raphson


@dataclass(frozen=True, slots=True)
class Emf6Options:
    load_model: str = "cc_p_cz_q"
    fd_eps: float = 3e-6
    equilibrium_tolerance: float = 1e-10
    newton_max_iterations: int = 300
    stability_tolerance: float = 1e-7

    def __post_init__(self) -> None:
        load_model = self.load_model.strip().lower()
        if load_model not in {"cz", "cz_p_cz_q", "cc_p_cz_q", "constant_power"}:
            raise PowerFlowError("emf6_load_model", "Unsupported EMF6 load model.")
        object.__setattr__(self, "load_model", load_model)
        if self.fd_eps <= 0 or self.equilibrium_tolerance <= 0 or self.newton_max_iterations < 1:
            raise PowerFlowError("emf6_options", "Invalid EMF6 numerical options.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "Emf6Options":
        if value is None:
            return cls()
        ignored = {"model"}
        resolved = {key: item for key, item in value.items() if key not in ignored}
        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(resolved) - allowed)
        if unknown:
            raise PowerFlowError("unknown_emf6_options", f"Unknown EMF6 options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class Emf6MachineData:
    xd: np.ndarray; xdp: np.ndarray; xdpp: np.ndarray
    xq: np.ndarray; xqp: np.ndarray; xqpp: np.ndarray; ra: np.ndarray
    tpd0: np.ndarray; tppd0: np.ndarray; tpq0: np.ndarray; tppq0: np.ndarray
    c_d: np.ndarray; d_d: np.ndarray; c_q: np.ndarray; d_q: np.ndarray
    synchronous_speed: float


@dataclass(frozen=True, slots=True)
class Emf6Units:
    bus_indices: np.ndarray
    bus_ids: np.ndarray
    inertia: np.ndarray
    damping: np.ndarray
    identifiers: tuple[str, ...]


@dataclass(slots=True)
class Emf6Dae:
    case: PowerCase
    options: Emf6Options
    machine: Emf6MachineData
    units: Emf6Units
    y_network: np.ndarray
    load_p: np.ndarray
    load_q: np.ndarray
    load_v0: np.ndarray
    x0: np.ndarray
    y0: np.ndarray
    field_voltage: np.ndarray
    mechanical_torque: np.ndarray
    state_names: tuple[str, ...]
    equilibrium_iterations: int
    pf: Any

    @property
    def num_machines(self) -> int:
        return self.units.bus_indices.size

    def machine_algebraic(
        self, x: np.ndarray, y: np.ndarray, machine_index: int
    ) -> tuple[float, float, float, float]:
        offset = 6 * machine_index
        delta, eqpp, edpp = x[offset], x[offset + 4], x[offset + 5]
        bus = self.units.bus_indices[machine_index]
        voltage = complex(y[2 * bus], y[2 * bus + 1])
        vd, vq = kundur_dq(voltage, delta)
        rhs_d, rhs_q = vd - edpp, vq - eqpp
        m = self.machine
        determinant = m.xdpp[machine_index] * m.xqpp[machine_index] + m.ra[machine_index] ** 2
        current_d = (-m.ra[machine_index] * rhs_d - m.xqpp[machine_index] * rhs_q) / determinant
        current_q = (m.xdpp[machine_index] * rhs_d - m.ra[machine_index] * rhs_q) / determinant
        return float(current_d), float(current_q), float(vd), float(vq)

    def differential(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        derivative = np.zeros_like(x)
        m, u = self.machine, self.units
        for k in range(self.num_machines):
            offset = 6 * k
            current_d, current_q, vd, vq = self.machine_algebraic(x, y, k)
            speed, eqp, edp, eqpp, edpp = x[offset + 1 : offset + 6]
            torque = vd * current_d + vq * current_q + m.ra[k] * (current_d**2 + current_q**2)
            derivative[offset] = m.synchronous_speed * speed
            derivative[offset + 1] = (
                self.mechanical_torque[k] - torque - u.damping[k] * speed
            ) / (2 * u.inertia[k])
            derivative[offset + 2] = (
                self.field_voltage[k] + m.c_d[k] * eqpp - m.d_d[k] * eqp
            ) / m.tpd0[k]
            derivative[offset + 3] = (m.c_q[k] * edpp - m.d_q[k] * edp) / m.tpq0[k]
            derivative[offset + 4] = (
                eqp - eqpp - (m.xdp[k] - m.xdpp[k]) * current_d
            ) / m.tppd0[k]
            derivative[offset + 5] = (
                edp - edpp + (m.xqp[k] - m.xqpp[k]) * current_q
            ) / m.tppq0[k]
        return derivative

    def network(self, x: np.ndarray, y: np.ndarray, y_network: np.ndarray | None = None) -> np.ndarray:
        matrix = self.y_network if y_network is None else y_network
        voltage = y[0::2] + 1j * y[1::2]
        network_current = matrix @ voltage
        residual = np.empty(2 * voltage.size)
        residual[0::2] = -network_current.real
        residual[1::2] = -network_current.imag
        for bus in range(voltage.size):
            if self.load_p[bus] == 0 and self.load_q[bus] == 0:
                continue
            if self.options.load_model in {"cz", "cz_p_cz_q"}:
                load_current = 0j
            elif self.options.load_model == "cc_p_cz_q":
                magnitude = abs(voltage[bus])
                load_current = self.load_p[bus] / self.load_v0[bus] * voltage[bus] / magnitude
            else:
                load_current = np.conj(complex(self.load_p[bus], self.load_q[bus]) / voltage[bus])
            residual[2 * bus : 2 * bus + 2] -= [load_current.real, load_current.imag]
        for k in range(self.num_machines):
            current_d, current_q, _, _ = self.machine_algebraic(x, y, k)
            current = kundur_network_current(current_d, current_q, x[6 * k])
            bus = self.units.bus_indices[k]
            residual[2 * bus : 2 * bus + 2] += [current.real, current.imag]
        return residual

    def electrical_power(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        result = np.zeros(self.num_machines)
        for k in range(self.num_machines):
            current_d, current_q, vd, vq = self.machine_algebraic(x, y, k)
            result[k] = vd * current_d + vq * current_q + self.machine.ra[k] * (
                current_d**2 + current_q**2
            )
        return result


@dataclass(frozen=True, slots=True)
class Emf6SssaResult:
    system_name: str
    model: str
    state_names: tuple[str, ...]
    generator_bus_ids: np.ndarray
    x0: np.ndarray; y0: np.ndarray
    jxx: np.ndarray; jxy: np.ndarray; jyx: np.ndarray; jyy: np.ndarray
    a_full: np.ndarray; a_reduced: np.ndarray
    eigenvalues: np.ndarray; reduced_eigenvalues: np.ndarray
    frequency_hz: np.ndarray; damping_ratio: np.ndarray
    newton_iterations: int; newton_residual: float
    stability_status: str; root_counts: Mapping[str, int]
    dae: Emf6Dae

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name, "analysis": "sssa", "model": self.model,
            "states": len(self.state_names), "reduced_modes": int(self.reduced_eigenvalues.size),
            "stability_status": self.stability_status, "root_counts": dict(self.root_counts),
            "newton_residual": self.newton_residual,
        }


def kundur_dq(value: complex, delta: float) -> tuple[float, float]:
    return (
        float(np.sin(delta) * value.real - np.cos(delta) * value.imag),
        float(np.cos(delta) * value.real + np.sin(delta) * value.imag),
    )


def kundur_network_current(current_d: float, current_q: float, delta: float) -> complex:
    return complex(
        np.sin(delta) * current_d + np.cos(delta) * current_q,
        -np.cos(delta) * current_d + np.sin(delta) * current_q,
    )


def _expand(value: Any, count: int) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64).reshape(-1)
    if array.size == 1:
        array = np.full(count, array.item())
    if array.size != count:
        raise PowerFlowError("emf6_machine_data", "EMF6 machine parameter length mismatch.")
    return array


def _scalar_newton(function: Callable[[float], float], seed: float, opt: Emf6Options) -> tuple[float, int]:
    value = float(seed)
    for iteration in range(opt.newton_max_iterations + 1):
        residual = float(function(value))
        if abs(residual) <= opt.equilibrium_tolerance:
            return value, iteration
        increment = opt.fd_eps * (1 + abs(value))
        jacobian = (function(value + increment) - function(value - increment)) / (2 * increment)
        if not np.isfinite(jacobian) or abs(jacobian) < 1e-13:
            raise PowerFlowError("emf6_angle_jacobian", "EMF6 angle initialization is singular.")
        step = -residual / jacobian
        alpha = 1.0
        while alpha >= 2**-16:
            trial = value + alpha * step
            if np.isfinite(function(trial)) and abs(function(trial)) < abs(residual):
                value = trial
                break
            alpha *= 0.5
        else:
            raise PowerFlowError("emf6_angle_line_search", "EMF6 angle initialization failed.")
    raise PowerFlowError("emf6_angle_iterations", "EMF6 angle initialization exceeded its limit.")


def build_emf6_dae(case: PowerCase, options: Emf6Options | Mapping[str, Any] | None = None) -> Emf6Dae:
    opt = options if isinstance(options, Emf6Options) else Emf6Options.from_mapping(options)
    machines = case.dynamic_data.get("machines", {})
    required = {"base", "reactances", "time_constants", "units"}
    if not required.issubset(machines):
        raise PowerFlowError("emf6_machine_data", "Case does not provide operational EMF6 data.")
    units_raw = machines["units"]
    if isinstance(units_raw, dict):
        units_raw = [units_raw]
    count = len(units_raw); base = case.base_values.s_base_mva
    machine_base = _expand(machines["base"]["S_MVA"], count)
    scale = base / machine_base
    reactance = machines["reactances"]; constants = machines["time_constants"]
    xd = _expand(reactance["Xd"], count) * scale
    xdp = _expand(reactance["Xdp"], count) * scale
    xdpp = _expand(reactance["Xdpp"], count) * scale
    xq = _expand(reactance["Xq"], count) * scale
    xqp = _expand(reactance["Xqp"], count) * scale
    xqpp = _expand(reactance["Xqpp"], count) * scale
    ra = _expand(reactance["Ra"], count) * scale
    machine = Emf6MachineData(
        xd, xdp, xdpp, xq, xqp, xqpp, ra,
        _expand(constants["Tpd0"], count), _expand(constants["Tppd0"], count),
        _expand(constants["Tpq0"], count), _expand(constants["Tppq0"], count),
        (xd - xdp) / (xdp - xdpp), (xd - xdpp) / (xdp - xdpp),
        (xq - xqp) / (xqp - xqpp), (xq - xqpp) / (xqp - xqpp),
        2 * np.pi * case.base_values.frequency_hz,
    )
    model = prepare_case(case)
    bus_by_id = {int(bus): index for index, bus in enumerate(model.external_bus_ids)}
    bus_indices = np.asarray([bus_by_id[int(unit["bus"])] for unit in units_raw], dtype=np.int64)
    units = Emf6Units(
        bus_indices=bus_indices,
        bus_ids=np.asarray([int(unit["bus"]) for unit in units_raw], dtype=np.int64),
        inertia=np.asarray([float(unit["H"]) / scale[k] for k, unit in enumerate(units_raw)]),
        damping=np.asarray([float(unit["D"]) / scale[k] for k, unit in enumerate(units_raw)]),
        identifiers=tuple(str(unit["gen_id"]) for unit in units_raw),
    )
    pf = solve_newton_raphson(
        case, PowerFlowOptions(max_iter=opt.newton_max_iterations,
                               tolerance=opt.equilibrium_tolerance, enforce_q_limits=False)
    )
    if not pf.converged:
        raise PowerFlowError("emf6_power_flow", "Power flow did not converge for EMF6.")
    y_network = np.zeros_like(model.ybus)
    for row, start, end in zip(
        case.line_data, model.line_from_indices, model.line_to_indices, strict=True
    ):
        series = 1 / complex(row[2], row[3]); charging = 1j * row[4]
        y_network[start, start] += series + charging
        y_network[end, end] += series + charging
        y_network[start, end] -= series; y_network[end, start] -= series
    y_network[np.diag_indices_from(y_network)] += model.g_shunt + 1j * model.b_shunt
    if opt.load_model in {"cz", "cz_p_cz_q"}:
        y_network[np.diag_indices_from(y_network)] += (
            model.p_load - 1j * model.q_load
        ) / pf.bus_voltage**2
    elif opt.load_model == "cc_p_cz_q":
        y_network[np.diag_indices_from(y_network)] += -1j * model.q_load / pf.bus_voltage**2
    y0 = np.empty(2 * model.num_buses)
    voltage = pf.bus_voltage * np.exp(1j * pf.bus_angle)
    y0[0::2] = voltage.real; y0[1::2] = voltage.imag
    x0 = np.zeros(6 * count); field = np.zeros(count); torque = np.zeros(count)
    names: list[str] = []; total_iterations = 0
    placeholder = Emf6Dae(case, opt, machine, units, y_network, model.p_load, model.q_load,
                          pf.bus_voltage, x0, y0, field, torque, (), 0, pf)
    for k, bus in enumerate(bus_indices):
        terminal_voltage = voltage[bus]
        terminal_power = complex(pf.p_generation[bus], pf.q_generation[bus])
        terminal_current = np.conj(terminal_power / terminal_voltage)
        seed = np.angle(terminal_voltage + (ra[k] + 1j * xq[k]) * terminal_current)

        def angle_residual(delta: float) -> float:
            current_d, current_q = kundur_dq(terminal_current, delta)
            voltage_d, _ = kundur_dq(terminal_voltage, delta)
            return voltage_d + ra[k] * current_d - xq[k] * current_q

        delta, iterations = _scalar_newton(angle_residual, seed, opt)
        total_iterations += iterations
        current_d, current_q = kundur_dq(terminal_current, delta)
        voltage_d, voltage_q = kundur_dq(terminal_voltage, delta)
        eqpp = voltage_q + ra[k] * current_q + xdpp[k] * current_d
        edpp = voltage_d + ra[k] * current_d - xqpp[k] * current_q
        eqp = eqpp + (xdp[k] - xdpp[k]) * current_d
        edp = edpp - (xqp[k] - xqpp[k]) * current_q
        field[k] = machine.d_d[k] * eqp - machine.c_d[k] * eqpp
        torque[k] = voltage_d * current_d + voltage_q * current_q + ra[k] * (
            current_d**2 + current_q**2
        )
        x0[6 * k : 6 * k + 6] = [delta, 0, eqp, edp, eqpp, edpp]
        identifier = units.identifiers[k]
        names.extend((f"delta_{identifier}", f"omega_{identifier}", f"Eqp_{identifier}",
                      f"Edp_{identifier}", f"Eqpp_{identifier}", f"Edpp_{identifier}"))
    placeholder.state_names = tuple(names)
    placeholder.equilibrium_iterations = total_iterations
    return placeholder


def _numerical_jacobian(dae: Emf6Dae) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x, y, step = dae.x0, dae.y0, dae.options.fd_eps
    nx, ny = x.size, y.size
    jxx = np.zeros((nx, nx)); jxy = np.zeros((nx, ny))
    jyx = np.zeros((ny, nx)); jyy = np.zeros((ny, ny))
    for column in range(nx):
        plus = np.array(x, copy=True); minus = np.array(x, copy=True)
        plus[column] += step; minus[column] -= step
        jxx[:, column] = (dae.differential(plus, y) - dae.differential(minus, y)) / (2 * step)
        jyx[:, column] = (dae.network(plus, y) - dae.network(minus, y)) / (2 * step)
    for column in range(ny):
        plus = np.array(y, copy=True); minus = np.array(y, copy=True)
        plus[column] += step; minus[column] -= step
        jxy[:, column] = (dae.differential(x, plus) - dae.differential(x, minus)) / (2 * step)
        jyy[:, column] = (dae.network(x, plus) - dae.network(x, minus)) / (2 * step)
    return jxx, jxy, jyx, jyy


def _coi_reduce(a_full: np.ndarray, inertia: np.ndarray) -> np.ndarray:
    count, states = inertia.size, 6
    weights = inertia / inertia.sum(); columns = states * count - 2
    transform = np.zeros((states * count, columns)); column = 0
    for state in range(2, states):
        transform[state, column] = 1; column += 1
    for machine in range(1, count):
        base = states * machine
        transform[base, column] = 1; transform[0::states, column] -= weights; column += 1
        transform[base + 1, column] = 1; transform[1::states, column] -= weights; column += 1
        for state in range(2, states):
            transform[base + state, column] = 1; column += 1
    reduced, _, _, _ = np.linalg.lstsq(transform, a_full @ transform, rcond=None)
    return reduced


def solve_emf6_sssa(
    case: PowerCase, options: Emf6Options | Mapping[str, Any] | None = None
) -> Emf6SssaResult:
    dae = build_emf6_dae(case, options)
    residual = max(
        float(np.max(np.abs(dae.differential(dae.x0, dae.y0)))),
        float(np.max(np.abs(dae.network(dae.x0, dae.y0)))),
    )
    if residual > 100 * dae.options.equilibrium_tolerance:
        raise PowerFlowError("emf6_equilibrium", "EMF6 equilibrium residual exceeds tolerance.")
    jxx, jxy, jyx, jyy = _numerical_jacobian(dae)
    a_full = jxx - jxy @ np.linalg.solve(jyy, jyx)
    a_reduced = _coi_reduce(a_full, dae.units.inertia)
    eigenvalues = np.linalg.eigvals(a_full); reduced = np.linalg.eigvals(a_reduced)
    real = reduced.real; tolerance = dae.options.stability_tolerance
    unstable = int(np.count_nonzero(real > tolerance)); stable = int(np.count_nonzero(real < -tolerance))
    marginal = int(real.size - unstable - stable)
    status = "UNSTABLE" if unstable else ("MARGINAL" if marginal else "ASYMPTOTICALLY STABLE")
    magnitude = np.abs(eigenvalues)
    ratio = np.divide(-eigenvalues.real, magnitude, out=np.zeros_like(magnitude), where=magnitude > 0)
    return Emf6SssaResult(
        case.system_name, "emf6", dae.state_names, dae.units.bus_ids,
        np.array(dae.x0, copy=True), np.array(dae.y0, copy=True), jxx, jxy, jyx, jyy,
        a_full, a_reduced, eigenvalues, reduced, np.abs(eigenvalues.imag) / (2 * np.pi),
        ratio, dae.equilibrium_iterations, residual, status,
        MappingProxyType({"unstable": unstable, "stable": stable, "marginal": marginal}), dae,
    )
