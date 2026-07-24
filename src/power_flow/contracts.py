"""Typed public contracts for the power-flow reimplementation."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import IntEnum
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np
from numpy.typing import NDArray


FloatArray = NDArray[np.float64]
ComplexArray = NDArray[np.complex128]

POWER_CASE_SCHEMA = "power_case/1.0"


class BusType(IntEnum):
    REF = 1
    PV = 2
    PQ = 3


class PowerFlowError(ValueError):
    """Invalid input/schema error with a stable machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class BaseValues:
    s_base_mva: float = 100.0
    v_base_kv: float = 230.0
    frequency_hz: float = 60.0

    def __post_init__(self) -> None:
        values = (self.s_base_mva, self.v_base_kv, self.frequency_hz)
        if not all(np.isfinite(values)):
            raise PowerFlowError("base_values_nonfinite", "Base values must be finite.")
        if self.s_base_mva <= 0 or self.frequency_hz <= 0 or self.v_base_kv < 0:
            raise PowerFlowError(
                "base_values_invalid",
                "S base and frequency must be positive; V base must be non-negative.",
            )


def _readonly_float_matrix(value: Any, name: str) -> FloatArray:
    array = np.array(value, dtype=np.float64, copy=True)
    if array.ndim != 2:
        raise PowerFlowError(f"{name}_rank", f"{name} must be a two-dimensional matrix.")
    array.setflags(write=False)
    return array


def _standardize_bus_data(value: Any) -> FloatArray:
    data = _readonly_float_matrix(value, "bus_data")
    rows, columns = data.shape
    if rows == 0:
        raise PowerFlowError("bus_data_required", "bus_data is required.")
    if columns not in (8, 10, 12):
        raise PowerFlowError("bus_columns", "bus_data must have 8, 10, or 12 columns.")
    if columns < 12:
        result = np.zeros((rows, 12), dtype=np.float64)
        result[:, :columns] = data
        if columns == 8:
            result[:, 8:10] = 0.0
        result[:, 10] = -np.inf
        result[:, 11] = np.inf
        data = result
    else:
        data = np.array(data, copy=True)
    data.setflags(write=False)
    return data


def _standardize_line_data(value: Any) -> FloatArray:
    data = _readonly_float_matrix(value, "line_data")
    rows, columns = data.shape
    if rows == 0:
        raise PowerFlowError("line_data_required", "line_data is required.")
    if columns not in (4, 5, 6, 7):
        raise PowerFlowError("line_columns", "line_data must have 4, 5, 6, or 7 columns.")
    if columns < 7:
        result = np.zeros((rows, 7), dtype=np.float64)
        result[:, :columns] = data
        if columns < 6:
            result[:, 5] = 1.0
        data = result
    else:
        data = np.array(data, copy=True)
    data[data[:, 5] == 0.0, 5] = 1.0
    data.setflags(write=False)
    return data


@dataclass(frozen=True, slots=True)
class PowerCase:
    system_name: str
    base_values: BaseValues
    bus_data: FloatArray
    line_data: FloatArray
    schema_version: str = POWER_CASE_SCHEMA
    reference: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        if not self.system_name:
            raise PowerFlowError("system_name_required", "system_name is required.")
        if self.schema_version != POWER_CASE_SCHEMA:
            raise PowerFlowError(
                "schema_version",
                f"Expected schema {POWER_CASE_SCHEMA}; got {self.schema_version}.",
            )
        object.__setattr__(self, "bus_data", _standardize_bus_data(self.bus_data))
        object.__setattr__(self, "line_data", _standardize_line_data(self.line_data))
        object.__setattr__(self, "reference", MappingProxyType(dict(self.reference)))

    def with_bus_data(self, bus_data: Any) -> "PowerCase":
        return replace(self, bus_data=bus_data)


@dataclass(frozen=True, slots=True)
class PowerFlowOptions:
    max_iter: int = 20
    tolerance: float = 1e-6
    enforce_q_limits: bool = True
    q_limit_tolerance: float = 1e-6
    max_q_limit_switches: int = 20
    pf_method: str = "newton_raphson"
    acceleration: float = 1.4

    def __post_init__(self) -> None:
        if self.max_iter < 1:
            raise PowerFlowError("max_iter", "max_iter must be at least 1.")
        if self.max_q_limit_switches < 0:
            raise PowerFlowError(
                "max_q_limit_switches",
                "max_q_limit_switches must be non-negative.",
            )
        if not np.isfinite(self.tolerance) or self.tolerance <= 0:
            raise PowerFlowError("tolerance", "tolerance must be finite and positive.")
        if not np.isfinite(self.q_limit_tolerance) or self.q_limit_tolerance < 0:
            raise PowerFlowError(
                "q_limit_tolerance",
                "q_limit_tolerance must be finite and non-negative.",
            )
        canonical = self.pf_method.strip().lower() if isinstance(self.pf_method, str) else ""
        if canonical not in {"newton_raphson", "gauss_seidel", "fdpf_xb", "fdpf_bx", "bfs"}:
            raise PowerFlowError(
                "unknown_pf_method",
                "pf_method must be one of newton_raphson, gauss_seidel, fdpf_xb, fdpf_bx, bfs.",
            )
        object.__setattr__(self, "pf_method", canonical)
        if not np.isfinite(self.acceleration) or self.acceleration <= 0:
            raise PowerFlowError("acceleration", "acceleration must be finite and positive.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "PowerFlowOptions":
        if value is None:
            return cls()
        allowed = {item.name for item in cls.__dataclass_fields__.values()}
        unknown = sorted(set(value) - allowed)
        if unknown:
            raise PowerFlowError("unknown_options", f"Unknown PF options: {', '.join(unknown)}")
        resolved = dict(value)
        if "max_iter" not in resolved:
            method = str(resolved.get("pf_method", "newton_raphson")).strip().lower()
            resolved["max_iter"] = {
                "newton_raphson": 20,
                "gauss_seidel": 200,
                "fdpf_xb": 50,
                "fdpf_bx": 50,
                "bfs": 100,
            }.get(method, 20)
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class QLimitEvent:
    round: int
    bus_id: int
    from_type: str
    to_type: str
    q_generation_before: float
    q_fixed: float
    limit_type: str


@dataclass(frozen=True, slots=True)
class PowerFlowResult:
    system_name: str
    method: str
    converged: bool
    reason: str
    finite_status: str
    iterations: int
    max_mismatch: float
    mismatch_history: FloatArray
    external_bus_ids: NDArray[np.int64]
    bus_type: NDArray[np.int64]
    bus_voltage: FloatArray
    bus_angle: FloatArray
    bus_angle_deg: FloatArray
    p_generation: FloatArray
    q_generation: FloatArray
    p_injection: FloatArray
    q_injection: FloatArray
    p_load: FloatArray
    q_load: FloatArray
    line_endpoints: NDArray[np.int64]
    line_flow_p: FloatArray
    line_flow_q: FloatArray
    line_loss_p: FloatArray
    line_loss_q: FloatArray
    p_loss_total: float
    q_loss_total: float
    p_total_gen: float
    q_total_gen: float
    p_total_load: float
    q_total_load: float
    ybus: ComplexArray
    q_limit_events: tuple[QLimitEvent, ...]
    q_limit_rounds: int
    metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name,
            "method": self.method,
            "converged": self.converged,
            "reason": self.reason,
            "finite_status": self.finite_status,
            "iterations": self.iterations,
            "max_mismatch": self.max_mismatch,
            "p_loss_total": self.p_loss_total,
            "q_loss_total": self.q_loss_total,
            "bus_voltage": self.bus_voltage.tolist(),
            "bus_angle_deg": self.bus_angle_deg.tolist(),
        }
