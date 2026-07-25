"""Fixed-step transient simulation of the Padiyar model-1.1 DAE."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np

from power_flow.contracts import FloatArray, PowerCase, PowerFlowError
from power_flow.sssa.padiyar import PadiyarDae, PadiyarOptions, build_padiyar_dae
from power_flow.ts.emf6 import _jacobian_y, _solve_algebraic


@dataclass(frozen=True, slots=True)
class PadiyarTsOptions:
    model: str = "padiyar_1_1_avr"
    excitation: str = "avr"
    t_end: float = 10.0; dt: float = 0.01
    fault_bus: int = 3; t_fault: float = 1.0; t_clear: float = 1.1
    fault_impedance: complex = 0.1j; fault_enabled: bool = True
    integrator: str = "trapezoidal"; corrector_mode: str = "adaptive"
    max_corrector_iter: int = 12; corrector_abs_tol: float = 1e-10
    corrector_rel_tol: float = 1e-8; corrector_failure: str = "error"
    algebraic_tolerance: float = 1e-11

    def __post_init__(self) -> None:
        model = self.model.strip().lower(); excitation = self.excitation.strip().lower()
        if model == "padiyar_1_1_manual": excitation = "manual"
        if model not in {"padiyar_1_1_avr", "padiyar_1_1_manual"} or excitation not in {"avr", "manual"}:
            raise PowerFlowError("padiyar_ts_model", "Invalid Padiyar model or excitation.")
        expected = f"padiyar_1_1_{excitation}"
        if model != expected:
            raise PowerFlowError("padiyar_ts_model", "Padiyar model and excitation disagree.")
        object.__setattr__(self, "model", model); object.__setattr__(self, "excitation", excitation)
        if self.integrator.strip().lower() not in {"trapezoidal", "trap"}:
            raise PowerFlowError("padiyar_ts_integrator", "Verified Padiyar TS supports trapezoidal only.")
        object.__setattr__(self, "integrator", "trapezoidal")
        if self.corrector_mode.strip().lower() != "adaptive":
            raise PowerFlowError("padiyar_ts_corrector", "Verified Padiyar TS requires adaptive correctors.")
        object.__setattr__(self, "corrector_mode", "adaptive")
        failure = self.corrector_failure.strip().lower()
        if failure not in {"error", "continue"}:
            raise PowerFlowError("padiyar_ts_failure", "corrector_failure must be error or continue.")
        object.__setattr__(self, "corrector_failure", failure)
        if self.dt <= 0 or self.t_end < 0 or self.max_corrector_iter < 1:
            raise PowerFlowError("padiyar_ts_time", "Invalid Padiyar TS time or iteration option.")
        if min(self.algebraic_tolerance, self.corrector_abs_tol, self.corrector_rel_tol) <= 0:
            raise PowerFlowError("padiyar_ts_tolerance", "Padiyar TS tolerances must be positive.")
        if self.fault_enabled and (not np.isfinite(self.fault_impedance) or self.fault_impedance == 0):
            raise PowerFlowError("padiyar_ts_fault", "Fault impedance must be finite and non-zero.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "PadiyarTsOptions":
        if value is None: return cls()
        aliases = {"method": "integrator", "Zf": "fault_impedance"}
        resolved = {aliases.get(key, key): item for key, item in value.items()}
        if "model" in resolved:
            model = str(resolved["model"]).lower()
            if model not in {"padiyar_1_1_avr", "padiyar_1_1_manual"}:
                raise PowerFlowError("padiyar_ts_model", "Unknown Padiyar model route.")
            resolved["excitation"] = "manual" if model.endswith("manual") else "avr"
        elif str(resolved.get("excitation", "avr")).lower() == "manual":
            resolved["model"] = "padiyar_1_1_manual"
        unknown = sorted(set(resolved) - set(cls.__dataclass_fields__))
        if unknown:
            raise PowerFlowError("unknown_padiyar_ts_options", f"Unknown Padiyar TS options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class PadiyarTsResult:
    system_name: str; model: str; excitation: str; integrator: str
    time: FloatArray; delta: FloatArray; omega: FloatArray
    eqp: FloatArray; edp: FloatArray; efd: FloatArray
    electrical_power: FloatArray; reactive_power: FloatArray; bus_voltage: FloatArray
    generator_bus_ids: np.ndarray; inertia: FloatArray; machine_damping: FloatArray
    corrector_iterations: np.ndarray; corrector_residual: FloatArray
    corrector_update_norm: FloatArray; corrector_converged: np.ndarray
    algebraic_residual: FloatArray; event_indices: np.ndarray; event_side: np.ndarray
    nonconverged_step_count: int; initial_dae_residual: float; metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name, "analysis": "ts", "model": self.model,
            "excitation": self.excitation, "integrator": self.integrator,
            "steps": int(self.time.size - 1), "generators": int(self.generator_bus_ids.size),
            "nonconverged_step_count": self.nonconverged_step_count,
            "max_speed_deviation": float(np.max(np.abs(self.omega - 1))),
            "max_algebraic_residual": float(np.max(self.algebraic_residual, initial=0.0)),
        }


def _time_grid(opt: PadiyarTsOptions) -> np.ndarray:
    count = int(np.floor(opt.t_end / opt.dt + 1e-12)); time = np.arange(count + 1) * opt.dt
    if time[-1] < opt.t_end: time = np.append(time, opt.t_end)
    else: time[-1] = opt.t_end
    if opt.fault_enabled:
        for event in (opt.t_fault, opt.t_clear):
            if 0 < event < opt.t_end:
                nearest = int(np.argmin(np.abs(time - event))); time[nearest] = event
    return np.unique(time).astype(float)


def simulate_padiyar(case: PowerCase, options: PadiyarTsOptions | Mapping[str, Any] | None = None) -> PadiyarTsResult:
    opt = options if isinstance(options, PadiyarTsOptions) else PadiyarTsOptions.from_mapping(options)
    dae = build_padiyar_dae(case, PadiyarOptions(excitation=opt.excitation))
    bus_by_id = {int(bus): k for k, bus in enumerate(dae.pf.external_bus_ids)}
    if opt.fault_bus not in bus_by_id:
        raise PowerFlowError("padiyar_ts_fault_bus", f"Fault bus {opt.fault_bus} is not in the case.")
    pre = np.array(dae.y_network, copy=True); fault = np.array(pre, copy=True)
    if opt.fault_enabled: fault[bus_by_id[opt.fault_bus], bus_by_id[opt.fault_bus]] += 1 / opt.fault_impedance
    def topology(t: float) -> np.ndarray:
        return fault if opt.fault_enabled and t >= opt.t_fault and t < opt.t_clear else pre

    time = _time_grid(opt); steps = time.size - 1; ng = dae.num_machines; ns = dae.states_per_machine
    delta = np.zeros((time.size, ng)); omega = np.zeros_like(delta); eqp = np.zeros_like(delta); edp = np.zeros_like(delta)
    efd = np.full_like(delta, np.nan); pe = np.zeros_like(delta); qe = np.zeros_like(delta)
    voltage = np.zeros((time.size, dae.y0.size // 2)); iterations = np.zeros(steps, dtype=np.int64)
    residuals = np.zeros(steps); updates = np.zeros(steps); converged = np.zeros(steps, dtype=np.bool_); algebraic = np.zeros(steps)
    x = np.array(dae.x0, copy=True); y = np.array(dae.y0, copy=True)
    initial_residual = max(float(np.max(np.abs(dae.differential(x, y)))), float(np.max(np.abs(dae.network(x, y, pre)))))
    def record(index: int) -> None:
        delta[index] = x[0::ns]; omega[index] = x[1::ns]; eqp[index] = x[2::ns]; edp[index] = x[3::ns]
        if ns == 5: efd[index] = x[4::ns]
        pe[index] = dae.electrical_power(x, y); qe[index] = dae.reactive_power(x, y)
        voltage[index] = np.abs(y[0::2] + 1j * y[1::2])
    record(0)
    for index, h in enumerate(np.diff(time)):
        matrix_now = topology(float(time[index])); matrix_next = topology(float(time[index + 1]))
        jacobian = _jacobian_y(dae, x, y, matrix_now)
        y, _ = _solve_algebraic(dae, x, y, matrix_now, opt.algebraic_tolerance, jacobian)
        f0 = dae.differential(x, y); candidate = x + h * f0; y_candidate = y
        step_converged = False; update_norm = np.inf; residual_norm = np.inf
        for used in range(1, opt.max_corrector_iter + 1):
            y_candidate, _ = _solve_algebraic(dae, candidate, y_candidate, matrix_now, opt.algebraic_tolerance, jacobian)
            updated = x + 0.5 * h * (f0 + dae.differential(candidate, y_candidate))
            y_updated, _ = _solve_algebraic(dae, updated, y_candidate, matrix_now, opt.algebraic_tolerance, jacobian)
            equation = updated - x - 0.5 * h * (f0 + dae.differential(updated, y_updated))
            update_norm = float(np.max(np.abs(updated - candidate))); residual_norm = float(np.max(np.abs(equation)))
            candidate, y_candidate = updated, y_updated
            tolerance = opt.corrector_abs_tol + opt.corrector_rel_tol * max(1.0, float(np.max(np.abs(candidate))))
            if update_norm <= tolerance and residual_norm <= tolerance:
                step_converged = True; break
        iterations[index] = used; residuals[index] = residual_norm; updates[index] = update_norm; converged[index] = step_converged
        algebraic[index] = float(np.max(np.abs(dae.network(candidate, y_candidate, matrix_now))))
        if not step_converged and opt.corrector_failure == "error":
            raise PowerFlowError("padiyar_ts_corrector", f"Corrector failed at step {index + 1}.")
        x = candidate; next_jacobian = _jacobian_y(dae, x, y_candidate, matrix_next)
        y, _ = _solve_algebraic(dae, x, y_candidate, matrix_next, opt.algebraic_tolerance, next_jacobian)
        record(index + 1)
    event_side = np.zeros(time.size, dtype=np.int64); event_indices: list[int] = []
    if opt.fault_enabled:
        for event in (opt.t_fault, opt.t_clear):
            found = np.flatnonzero(np.abs(time - event) < opt.dt * 1e-10)
            if found.size: event_indices.append(int(found[0])); event_side[int(found[0])] = 1
    return PadiyarTsResult(
        case.system_name, opt.model, opt.excitation, "trapezoidal", time, delta, omega, eqp, edp, efd,
        pe, qe, voltage, np.array(dae.units.bus_ids, copy=True), np.array(dae.units.inertia, copy=True),
        np.array(dae.units.damping, copy=True), iterations, residuals, updates, converged, algebraic,
        np.asarray(event_indices, dtype=np.int64), event_side, int(np.count_nonzero(~converged)), initial_residual,
        MappingProxyType({"fault_bus": opt.fault_bus, "t_fault": opt.t_fault, "t_clear": opt.t_clear,
                          "dt": opt.dt, "method_source": "project-owned coupled DAE fixed-step integrator",
                          "event_contract": "left topology step; right topology endpoint record", "fallback_used": False}),
    )
