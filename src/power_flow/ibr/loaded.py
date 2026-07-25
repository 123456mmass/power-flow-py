"""Loaded single-IBR/infinite-bus equilibrium and SSSA load sweep."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow.contracts import PowerFlowError
from power_flow.ibr.reduced6 import _SmibDevice


@dataclass(frozen=True, slots=True)
class LoadedIbrOptions:
    ibr_analysis: str = "sssa_load_sweep"
    sssa_load_percentages: tuple[float, ...] = (0.0, 20.0, 40.0, 60.0, 80.0)
    tolerance: float = 1e-10
    max_iter: int = 100
    fd_eps: float = 1e-6

    def __post_init__(self) -> None:
        if self.ibr_analysis.strip().lower() != "sssa_load_sweep":
            raise PowerFlowError("ibr_analysis", "Loaded SMIB cases support only sssa_load_sweep.")
        object.__setattr__(self, "ibr_analysis", "sssa_load_sweep")
        percentages = tuple(float(value) for value in self.sssa_load_percentages)
        object.__setattr__(self, "sssa_load_percentages", percentages)
        values = np.asarray(percentages)
        if values.ndim != 1 or values.size == 0 or np.any(~np.isfinite(values)):
            raise PowerFlowError("ibr_load_sweep", "Load percentages must be a finite nonempty sequence.")
        if np.any(values < 0) or np.any(np.diff(values) <= 0):
            raise PowerFlowError("ibr_load_sweep", "Load percentages must be nonnegative and strictly increasing.")
        if self.tolerance <= 0 or self.fd_eps <= 0 or self.max_iter <= 0:
            raise PowerFlowError("ibr_load_sweep", "Invalid loaded-SMIB numerical options.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "LoadedIbrOptions":
        if value is None:
            return cls()
        ignored = {"plot_results", "plot_visible", "verbose", "sssa_save_plots", "case_id"}
        resolved = {key: item for key, item in value.items() if key not in ignored}
        unknown = sorted(set(resolved) - set(cls.__dataclass_fields__))
        if unknown:
            raise PowerFlowError("unknown_ibr_options", f"Unknown loaded-SMIB options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class LoadedIbrPoint:
    load_percentage: float
    load_scale: float
    p_load: float
    q_load: float
    converged: bool
    iterations: int
    residual_norm: float
    state_names: tuple[str, ...]
    x_equilibrium: np.ndarray
    y_equilibrium: np.ndarray
    u_equilibrium: np.ndarray
    f_residual: np.ndarray
    g_residual: np.ndarray
    fx: np.ndarray
    fy: np.ndarray
    gx: np.ndarray
    gy: np.ndarray
    state_matrix: np.ndarray
    eigenvalues: np.ndarray
    stability_status: str
    terminal_power: complex


@dataclass(frozen=True, slots=True)
class LoadedIbrResult:
    case_id: str
    system_name: str
    kind: str
    product: str
    converged: bool
    load_percentages: np.ndarray
    load_scales: np.ndarray
    points: tuple[LoadedIbrPoint, ...]
    tracked_eigenvalues: np.ndarray
    metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        max_real = max(float(np.max(point.eigenvalues.real)) for point in self.points)
        min_voltage = min(float(abs(complex(*point.y_equilibrium))) for point in self.points)
        return {
            "system_name": self.system_name, "analysis": "ibr", "case_id": self.case_id,
            "kind": self.kind, "product": self.product, "converged": self.converged,
            "points": len(self.points), "load_percentages": self.load_percentages.tolist(),
            "minimum_terminal_voltage": min_voltage, "worst_max_real_eigenvalue": max_real,
            "fallback_used": False,
        }


def _loaded_network(
    device: _SmibDevice, x: np.ndarray, y: np.ndarray, v_inf: complex,
    impedance: complex, p_load: float, q_load: float,
) -> np.ndarray:
    voltage = complex(y[0], y[1])
    if abs(voltage) < 0.10:
        raise PowerFlowError("ibr_voltage_domain", "Loaded-SMIB terminal voltage is below the model domain.")
    load_current = np.conj(complex(p_load, q_load) / voltage)
    mismatch = device.current(x, voltage) - (voltage-v_inf)/impedance - load_current
    return np.array([mismatch.real, mismatch.imag])


def _stage_one_voltage(
    v_inf: complex, impedance: complex, p_load: float, q_load: float,
    p_ibr: float, q_ibr: float,
) -> complex:
    constant = -impedance * np.conj(complex(p_ibr-p_load, q_ibr-q_load))
    root = np.sqrt(v_inf**2 - 4*constant)
    candidates = ((v_inf+root)/2, (v_inf-root)/2)
    voltage = min(candidates, key=lambda value: abs(value-v_inf))
    return v_inf if not np.isfinite(voltage) or abs(voltage) < 1e-6 else voltage


def _consistent_gfm_q(voltage: complex, p_ibr: float, voltage_reference: float) -> float:
    def residual(q_value: float) -> float:
        current = np.conj(complex(p_ibr, q_value) / voltage)
        internal = voltage + 1j*0.15*current
        return voltage_reference - 0.05*q_value - abs(internal)

    low, high = -2.0, 2.0
    f_low, f_high = residual(low), residual(high)
    if f_low == 0: return low
    if f_high == 0: return high
    if f_low*f_high > 0:
        raise PowerFlowError("ibr_loaded_gfm_equilibrium", "No consistent GFM reactive-power root.")
    for _ in range(200):
        middle = 0.5*(low+high); f_middle = residual(middle)
        if abs(f_middle) <= 1e-10: return middle
        if f_low*f_middle < 0: high = middle
        else: low, f_low = middle, f_middle
    return 0.5*(low+high)


def _initial_state(kind: str, device: _SmibDevice, voltage: complex, p_ibr: float, q_ibr: float) -> np.ndarray:
    if kind == "gfl_rms10":
        magnitude = abs(voltage)
        return np.array([np.angle(voltage),0,p_ibr,q_ibr,0,0,0,0,p_ibr/magnitude,-q_ibr/magnitude])
    q_value = _consistent_gfm_q(voltage, p_ibr, float(device.u0[1]))
    current = np.conj(complex(p_ibr,q_value)/voltage)
    internal = voltage + 1j*0.15*current
    return np.array([np.angle(internal),0.0,p_ibr,q_value])


def _equilibrium(
    kind: str, device: _SmibDevice, v_inf: complex, impedance: complex,
    p_load: float, q_load: float, p_ibr: float, q_ibr: float, opt: LoadedIbrOptions,
) -> tuple[np.ndarray,np.ndarray,int,float,np.ndarray,np.ndarray]:
    voltage = _stage_one_voltage(v_inf,impedance,p_load,q_load,p_ibr,q_ibr)
    x0 = _initial_state(kind,device,voltage,p_ibr,q_ibr)
    z = np.concatenate((x0,[voltage.real,voltage.imag])); nx=x0.size

    def residual(value: np.ndarray) -> np.ndarray:
        x=value[:nx]; y=value[nx:]
        return np.concatenate((device.rhs(x,y),_loaded_network(device,x,y,v_inf,impedance,p_load,q_load)))

    current_residual=residual(z); residual_norm=float(np.max(np.abs(current_residual)))
    iterations=0
    while residual_norm > opt.tolerance and iterations < opt.max_iter:
        iterations += 1; jacobian=np.zeros((nx+2,nx+2))
        for j in range(nx+2):
            perturbed=z.copy(); perturbed[j]+=opt.fd_eps
            jacobian[:,j]=(residual(perturbed)-current_residual)/opt.fd_eps
        reciprocal_condition=1/np.linalg.cond(jacobian)
        if not np.isfinite(reciprocal_condition) or reciprocal_condition <= 1e-12:
            raise PowerFlowError("ibr_loaded_equilibrium", "Loaded-SMIB equilibrium Jacobian is ill-conditioned.")
        correction=np.linalg.solve(jacobian,-current_residual); step=1.0
        for _ in range(20):
            candidate=z+step*correction
            try: candidate_residual=residual(candidate)
            except PowerFlowError: step*=0.5; continue
            if np.max(np.abs(candidate_residual)) < (1-1e-4*step)*residual_norm:
                z=candidate; current_residual=candidate_residual; break
            step*=0.5
        else:
            raise PowerFlowError("ibr_loaded_equilibrium", "Loaded-SMIB Newton line search made no progress.")
        residual_norm=float(np.max(np.abs(current_residual)))
    if residual_norm > opt.tolerance:
        raise PowerFlowError("ibr_loaded_equilibrium", "Loaded-SMIB equilibrium did not converge.")
    x=z[:nx]; y=z[nx:]
    return x,y,iterations,residual_norm,device.rhs(x,y),_loaded_network(device,x,y,v_inf,impedance,p_load,q_load)


def _linearize(
    device: _SmibDevice, x: np.ndarray, y: np.ndarray, v_inf: complex,
    impedance: complex, p_load: float, q_load: float, h: float,
) -> tuple[np.ndarray,np.ndarray,np.ndarray,np.ndarray,np.ndarray,np.ndarray]:
    nx=x.size; fx=np.zeros((nx,nx)); fy=np.zeros((nx,2)); gx=np.zeros((2,nx)); gy=np.zeros((2,2))
    for j in range(nx):
        xp=x.copy();xm=x.copy();xp[j]+=h;xm[j]-=h
        fx[:,j]=(device.rhs(xp,y)-device.rhs(xm,y))/(2*h)
        gx[:,j]=(_loaded_network(device,xp,y,v_inf,impedance,p_load,q_load)-_loaded_network(device,xm,y,v_inf,impedance,p_load,q_load))/(2*h)
    for j in range(2):
        yp=y.copy();ym=y.copy();yp[j]+=h;ym[j]-=h
        fy[:,j]=(device.rhs(x,yp)-device.rhs(x,ym))/(2*h)
        gy[:,j]=(_loaded_network(device,x,yp,v_inf,impedance,p_load,q_load)-_loaded_network(device,x,ym,v_inf,impedance,p_load,q_load))/(2*h)
    if 1/np.linalg.cond(gy) <= 1e-10:
        raise PowerFlowError("ibr_loaded_sssa", "Loaded-SMIB algebraic Jacobian is ill-conditioned.")
    matrix=fx-fy@np.linalg.solve(gy,gx)
    return fx,fy,gx,gy,matrix,np.linalg.eigvals(matrix)


def _track_modes(points: tuple[LoadedIbrPoint,...]) -> np.ndarray:
    tracked=np.empty((len(points),points[0].eigenvalues.size),dtype=complex)
    tracked[0]=points[0].eigenvalues
    for k in range(1,len(points)):
        previous=tracked[k-1]; current=points[k].eigenvalues
        rows,columns=linear_sum_assignment(np.abs(previous[:,None]-current[None,:]))
        tracked[k,rows]=current[columns]
    return tracked


def solve_loaded_smib_sweep(
    case_id: str, options: LoadedIbrOptions | Mapping[str,Any] | None = None,
) -> LoadedIbrResult:
    opt=options if isinstance(options,LoadedIbrOptions) else LoadedIbrOptions.from_mapping(options)
    case_key=case_id.strip().lower(); cases={
        "gfl_rms10_loaded_smib":("gfl_rms10","GFL-RMS10 Loaded SMIB"),
        "gfm_no_pll_loaded_smib":("gfm_no_pll","GFM-VSG no-PLL Loaded SMIB"),
    }
    if case_key not in cases:
        raise PowerFlowError("ibr_case_not_implemented",f"Loaded IBR case {case_id!r} is not implemented.")
    kind,system_name=cases[case_key];v_inf=1+0j;impedance=0.02+0.20j
    p_base=0.4; q_base=0.1
    device=_SmibDevice(kind,1+0j,p_base,q_base)
    if kind == "gfm_no_pll": device.u0[1]=1.0
    points=[]
    for percentage in opt.sssa_load_percentages:
        scale=1+percentage/100;p_load=scale*p_base;q_load=scale*q_base
        x,y,iterations,residual_norm,f0,g0=_equilibrium(
            kind,device,v_inf,impedance,p_load,q_load,p_base,q_base,opt,
        )
        fx,fy,gx,gy,matrix,eigenvalues=_linearize(device,x,y,v_inf,impedance,p_load,q_load,opt.fd_eps)
        status="UNSTABLE" if np.any(eigenvalues.real>1e-7) else ("MARGINAL" if np.any(np.abs(eigenvalues.real)<=1e-7) else "ASYMPTOTICALLY STABLE")
        voltage=complex(y[0],y[1]);power=voltage*np.conj(device.current(x,voltage))
        points.append(LoadedIbrPoint(
            percentage,scale,p_load,q_load,True,iterations,residual_norm,device.state_names,
            x,y,device.u0.copy(),f0,g0,fx,fy,gx,gy,matrix,eigenvalues,status,power,
        ))
    frozen_points=tuple(points);tracked=_track_modes(frozen_points)
    return LoadedIbrResult(
        case_key,system_name,kind,opt.ibr_analysis,True,np.asarray(opt.sssa_load_percentages),
        1+np.asarray(opt.sssa_load_percentages)/100,frozen_points,tracked,
        MappingProxyType({
            "classification":"ASSUMED_DIAGNOSTIC_SMIB_LOADED_IBR",
            "method_source":"project-owned coupled Newton, Schur SSSA, and mode assignment",
            "load_policy":"constant-power-factor shunt load; fixed IBR setpoint",
            "fallback_used":False,
        }),
    )
