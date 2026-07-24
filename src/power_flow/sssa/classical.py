"""Classical multimachine small-signal stability analysis."""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np
from numpy.typing import NDArray
from scipy.linalg import lu_factor, lu_solve

from power_flow.contracts import ComplexArray, FloatArray, PowerCase, PowerFlowError, PowerFlowOptions
from power_flow.network import prepare_case
from power_flow.pf import solve_newton_raphson


@dataclass(frozen=True, slots=True)
class SssaOptions:
    model: str = "classical"
    fd_eps: float = 1e-6
    stability_tolerance: float = 1e-7
    h: Any = None
    d: Any = None
    xdp: Any = None

    def __post_init__(self) -> None:
        if self.model.strip().lower() != "classical":
            raise PowerFlowError("sssa_model_not_implemented", "Only classical SSSA is implemented.")
        object.__setattr__(self, "model", "classical")
        if not np.isfinite(self.fd_eps) or self.fd_eps <= 0:
            raise PowerFlowError("sssa_fd_eps", "fd_eps must be finite and positive.")
        if not np.isfinite(self.stability_tolerance) or self.stability_tolerance < 0:
            raise PowerFlowError("sssa_stability_tolerance", "stability_tolerance must be non-negative.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "SssaOptions":
        if value is None:
            return cls()
        aliases = {"H": "h", "D": "d", "Xdp": "xdp"}
        resolved = {aliases.get(key, key): item for key, item in value.items()}
        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(resolved) - allowed)
        if unknown:
            raise PowerFlowError("unknown_sssa_options", f"Unknown SSSA options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class SssaResult:
    system_name: str
    model: str
    state_names: tuple[str, ...]
    generator_bus_ids: NDArray[np.int64]
    a_full: FloatArray
    a_reduced: FloatArray
    k_pe_delta: FloatArray
    inertia: FloatArray
    machine_damping: FloatArray
    transient_reactance: FloatArray
    delta0: FloatArray
    internal_voltage_magnitude: FloatArray
    eigenvalues: ComplexArray
    reduced_eigenvalues: ComplexArray
    frequency_hz: FloatArray
    damping_ratio: FloatArray
    stability_status: str
    stability_tolerance: float
    root_counts: Mapping[str, int]
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name,
            "analysis": "sssa",
            "model": self.model,
            "states": len(self.state_names),
            "reduced_modes": int(self.reduced_eigenvalues.size),
            "stability_status": self.stability_status,
            "root_counts": dict(self.root_counts),
        }


def _vector_override(value: Any, count: int, default: np.ndarray, name: str) -> np.ndarray:
    if value is None:
        return default
    result = np.asarray(value, dtype=np.float64).reshape(-1)
    if result.size == 1:
        result = np.full(count, result.item())
    if result.size != count or not np.all(np.isfinite(result)):
        raise PowerFlowError(f"sssa_{name}", f"{name} must be scalar or have one value per generator bus.")
    return result


def _machine_parameters(
    case: PowerCase, generator_bus_ids: np.ndarray, options: SssaOptions
) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
    count = generator_bus_ids.size
    h = np.full(count, 5.0); d = np.zeros(count); xdp = np.full(count, 0.3)
    machines = case.dynamic_data.get("machines", {})
    source = "project classical defaults: H=5 s, D=0, Xdp=0.3 pu"
    if machines:
        units = machines.get("units", [])
        if isinstance(units, dict):
            units = [units]
        ratio = 1.0
        shared_xdp = None
        if machines.get("reactances") and machines.get("base"):
            ratio = float(machines["base"]["S_MVA"]) / case.base_values.s_base_mva
            shared_xdp = float(machines["reactances"]["Xdp"]) / ratio
        for index, bus_id in enumerate(generator_bus_ids):
            matched = [unit for unit in units if int(unit["bus"]) == int(bus_id)]
            if not matched:
                raise PowerFlowError("sssa_machine_missing", f"No machine data for generator bus {bus_id}.")
            h[index] = sum(float(unit["H"]) * ratio for unit in matched)
            d[index] = sum(float(unit["D"]) * ratio for unit in matched)
            reactances = [shared_xdp if shared_xdp is not None else float(unit["Xdp"]) for unit in matched]
            xdp[index] = 1.0 / sum(1.0 / item for item in reactances)
        source = "case machine data"
    h = _vector_override(options.h, count, h, "H")
    d = _vector_override(options.d, count, d, "D")
    xdp = _vector_override(options.xdp, count, xdp, "Xdp")
    if np.any(h <= 0) or np.any(xdp <= 0):
        raise PowerFlowError("sssa_machine_parameters", "H and Xdp must be positive.")
    return h, d, xdp, source


def _coi_reduce(a_full: np.ndarray, inertia: np.ndarray) -> np.ndarray:
    machines = inertia.size
    if machines == 1:
        return np.zeros((0, 0))
    weights = inertia / inertia.sum()
    transform = np.zeros((2 * machines, 2 * machines - 2))
    column = 0
    for machine in range(1, machines):
        transform[2 * machine, column] = 1.0
        transform[0::2, column] -= weights
        column += 1
        transform[2 * machine + 1, column] = 1.0
        transform[1::2, column] -= weights
        column += 1
    reduced, _, _, _ = np.linalg.lstsq(transform, a_full @ transform, rcond=None)
    return reduced


def solve_classical_sssa(
    case: PowerCase, options: SssaOptions | Mapping[str, Any] | None = None
) -> SssaResult:
    opt = options if isinstance(options, SssaOptions) else SssaOptions.from_mapping(options)
    model = prepare_case(case)
    pf = solve_newton_raphson(
        case, PowerFlowOptions(max_iter=50, tolerance=1e-10, enforce_q_limits=False)
    )
    if not pf.converged:
        raise PowerFlowError("sssa_power_flow", "Power flow did not converge for SSSA initialization.")
    # Dynamic machine order follows the source generator/bus row order; it is
    # intentionally distinct from the PF state order (PV then PQ).
    generator_indices = np.flatnonzero(np.isin(model.bus_type, [1, 2]))
    generator_bus_ids = model.external_bus_ids[generator_indices]
    h, damping, xdp, dynamic_source = _machine_parameters(case, generator_bus_ids, opt)
    voltage0 = pf.bus_voltage * np.exp(1j * pf.bus_angle)
    load_power = model.p_load + 1j * model.q_load
    ynet = model.ybus + np.diag(np.conj(load_power) / (np.abs(voltage0) ** 2 + np.finfo(float).eps))
    eq = np.zeros(generator_indices.size, dtype=np.complex128)
    for k, bus in enumerate(generator_indices):
        generation = pf.p_generation[bus] + 1j * pf.q_generation[bus]
        current = np.conj(generation / voltage0[bus])
        eq[k] = voltage0[bus] + 1j * xdp[k] * current
    delta0 = np.angle(eq); eq_magnitude = np.abs(eq)
    y_with_generators = np.array(ynet, copy=True)
    for bus, reactance in zip(generator_indices, xdp, strict=True):
        y_with_generators[bus, bus] += 1.0 / (1j * reactance)
    factor = lu_factor(y_with_generators)

    def electrical_power(delta: np.ndarray) -> np.ndarray:
        injection = np.zeros(model.num_buses, dtype=np.complex128)
        internal_voltage = eq_magnitude * np.exp(1j * delta)
        for bus, reactance, internal in zip(generator_indices, xdp, internal_voltage, strict=True):
            injection[bus] += internal / (1j * reactance)
        voltage = lu_solve(factor, injection)
        current = (internal_voltage - voltage[generator_indices]) / (1j * xdp)
        return np.real(voltage[generator_indices] * np.conj(current))

    count = generator_indices.size
    coupling = np.zeros((count, count))
    for column in range(count):
        plus = np.array(delta0, copy=True); minus = np.array(delta0, copy=True)
        plus[column] += opt.fd_eps; minus[column] -= opt.fd_eps
        coupling[:, column] = (electrical_power(plus) - electrical_power(minus)) / (2 * opt.fd_eps)
    synchronous_speed = 2 * np.pi * case.base_values.frequency_hz
    grouped = np.block([
        [np.zeros((count, count)), synchronous_speed * np.eye(count)],
        [-np.diag(1.0 / (2 * h)) @ coupling, -np.diag(damping / (2 * h))],
    ])
    permutation = np.arange(2 * count).reshape(2, count).T.reshape(-1)
    a_full = grouped[np.ix_(permutation, permutation)]
    a_reduced = _coi_reduce(a_full, h)
    eigenvalues = np.linalg.eigvals(a_full)
    reduced_eigenvalues = np.linalg.eigvals(a_reduced)
    real_part = reduced_eigenvalues.real
    unstable = int(np.count_nonzero(real_part > opt.stability_tolerance))
    stable = int(np.count_nonzero(real_part < -opt.stability_tolerance))
    marginal = int(real_part.size - unstable - stable)
    if real_part.size == 0:
        status = "NOT APPLICABLE - NO RELATIVE MODES"
    elif unstable:
        status = "UNSTABLE"
    elif marginal:
        status = "MARGINAL"
    else:
        status = "ASYMPTOTICALLY STABLE"
    names = tuple(
        name
        for machine, bus_id in enumerate(generator_bus_ids, start=1)
        for name in (f"delta_G{machine}@Bus{bus_id}", f"omega_G{machine}@Bus{bus_id}")
    )
    magnitude = np.abs(eigenvalues)
    damping_ratio = np.divide(-eigenvalues.real, magnitude, out=np.zeros_like(magnitude), where=magnitude > 0)
    return SssaResult(
        system_name=case.system_name, model="classical", state_names=names,
        generator_bus_ids=np.array(generator_bus_ids, copy=True), a_full=a_full,
        a_reduced=a_reduced, k_pe_delta=coupling, inertia=h,
        machine_damping=damping, transient_reactance=xdp, delta0=delta0,
        internal_voltage_magnitude=eq_magnitude, eigenvalues=eigenvalues,
        reduced_eigenvalues=reduced_eigenvalues,
        frequency_hz=np.abs(eigenvalues.imag) / (2 * np.pi), damping_ratio=damping_ratio,
        stability_status=status, stability_tolerance=opt.stability_tolerance,
        root_counts=MappingProxyType({"unstable": unstable, "stable": stable, "marginal": marginal}),
        metadata=MappingProxyType({"plugin": "classical_network_linearization",
                                   "dynamic_data_source": dynamic_source}),
    )
