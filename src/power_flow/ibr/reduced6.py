"""Project-owned reduced six-state GFL/GFM single-infinite-bus models."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np
from power_flow.contracts import PowerFlowError


@dataclass(frozen=True, slots=True)
class IbrOptions:
    ibr_analysis: str = "full"
    t_end: float = 0.05
    dt: float = 1e-3
    perturb_state: int = 3
    perturb_amplitude: float = 1e-3
    fd_eps: float = 1e-6
    newton_tolerance: float = 1e-9
    newton_max_iterations: int = 50

    def __post_init__(self) -> None:
        product = self.ibr_analysis.strip().lower()
        if product not in {"pf", "sssa", "ts", "full"}:
            raise PowerFlowError("ibr_analysis", "IBR analysis must be pf, sssa, ts, or full.")
        object.__setattr__(self, "ibr_analysis", product)
        if self.dt <= 0 or self.t_end < 0 or self.fd_eps <= 0 or self.newton_tolerance <= 0:
            raise PowerFlowError("ibr_options", "Invalid IBR numerical options.")
        if not 1 <= self.perturb_state <= 10 or self.perturb_amplitude <= 0:
            raise PowerFlowError("ibr_perturbation", "Invalid IBR perturbation.")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "IbrOptions":
        if value is None: return cls()
        ignored = {"plot_results", "plot_visible", "verbose", "ibr_events"}
        aliases = {"perturb_amp": "perturb_amplitude"}
        resolved = {aliases.get(k, k): v for k, v in value.items() if k not in ignored}
        unknown = sorted(set(resolved) - set(cls.__dataclass_fields__))
        if unknown:
            raise PowerFlowError("unknown_ibr_options", f"Unknown IBR options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class IbrResult:
    case_id: str; system_name: str; kind: str; product: str; converged: bool
    state_names: tuple[str, ...]; x_equilibrium: np.ndarray; y_equilibrium: np.ndarray
    u_equilibrium: np.ndarray; infinite_bus_voltage: complex; line_impedance: complex
    f_residual: np.ndarray; g_residual: np.ndarray; terminal_power: complex
    fx: np.ndarray | None; fy: np.ndarray | None; gx: np.ndarray | None; gy: np.ndarray | None
    state_matrix: np.ndarray | None; eigenvalues: np.ndarray | None; stability_status: str | None
    time: np.ndarray | None; drift_state: np.ndarray | None; drift_voltage: np.ndarray | None
    perturbed_state: np.ndarray | None; perturbed_voltage: np.ndarray | None
    max_equilibrium_drift: float | None; newton_residual: np.ndarray | None
    metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        result = {
            "system_name": self.system_name, "analysis": "ibr", "case_id": self.case_id,
            "kind": self.kind, "product": self.product, "converged": self.converged,
            "states": len(self.state_names), "fallback_used": False,
        }
        if self.eigenvalues is not None:
            result["stability_status"] = self.stability_status
            result["max_real_eigenvalue"] = float(np.max(self.eigenvalues.real))
        if self.time is not None:
            result["steps"] = int(self.time.size - 1)
            result["max_equilibrium_drift"] = self.max_equilibrium_drift
        return result


class _SmibDevice:
    omega_b = 2 * np.pi * 60.0
    kappa = 1.0
    kp_i = 0.30
    resistance = 0.015
    inductance = 0.15

    def __init__(self, kind: str, voltage: complex, p: float, q: float) -> None:
        self.kind = kind; self.voltage = voltage; self.p = p; self.q = q
        self.omega_b = 2 * np.pi * 60.0
        if kind == "gfl_reduced6":
            self.state_names = ("i_d", "i_q", "delta_PLL", "xi_PLL", "xi_P", "xi_Q")
            magnitude = abs(voltage)
            self.x0 = np.array([p / magnitude, -q / magnitude, np.angle(voltage), 0, p / magnitude / 2.5, q / magnitude / 2.5])
            self.u0 = np.array([p, q])
        elif kind == "gfm_reduced6":
            self.state_names = ("i_d", "i_q", "omega", "delta", "E", "xi_V")
            current = np.conj(complex(p, q) / voltage); a = current; b = 1.2 * voltage
            delta = np.arctan2(-(a.real + b.imag), a.imag - b.real)
            if (voltage * np.exp(-1j * delta)).real < 0: delta += np.pi
            delta = np.arctan2(np.sin(delta), np.cos(delta)); vd = (voltage * np.exp(-1j * delta)).real
            rotated = current * np.exp(-1j * delta); i_d, i_q = rotated.real, rotated.imag
            q_ref = q + 8.0 * (vd - abs(voltage)) / 0.25
            self.x0 = np.array([i_d, i_q, 1.0, delta, vd, -i_q / 4.5])
            self.u0 = np.array([p, q_ref])
        elif kind == "gfm_no_pll":
            self.omega_b = 2 * np.pi * 50.0
            self.state_names = ("delta_vsm", "delta_omega_vsm", "P_f", "Q_f")
            terminal_current = np.conj(complex(p, q) / voltage)
            internal = voltage + 1j * 0.15 * terminal_current
            voltage_reference = abs(internal) + 0.05 * q
            self.x0 = np.array([np.angle(internal), 0.0, p, q])
            self.u0 = np.array([p, voltage_reference])
        elif kind == "gfl_rms10":
            self.state_names = (
                "delta_PLL", "xi_PLL", "P_f", "Q_f", "xi_P", "xi_Q",
                "xi_id", "xi_iq", "i_d", "i_q",
            )
            magnitude = abs(voltage)
            self.x0 = np.array([np.angle(voltage), 0, p, q, 0, 0, 0, 0, p / magnitude, -q / magnitude])
            self.u0 = np.array([p, q])
        else:
            raise PowerFlowError("ibr_kind", "Unknown reduced-six IBR kind.")

    def current(self, x: np.ndarray, voltage: complex | None = None) -> complex:
        if self.kind == "gfl_reduced6":
            return complex(x[0], x[1]) * np.exp(1j * x[2])
        if self.kind == "gfm_reduced6":
            return complex(x[0], x[1]) * np.exp(1j * x[3])
        if self.kind == "gfl_rms10":
            return complex(x[8], x[9]) * np.exp(1j * x[0])
        voltage_reference = self.u0[1]
        internal_magnitude = voltage_reference - 0.05 * x[3]
        internal = internal_magnitude * np.exp(1j * x[0])
        terminal = self.voltage if voltage is None else voltage
        return (internal - terminal) / (1j * 0.15)

    def rhs(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        voltage = complex(y[0], y[1]); current = self.current(x, voltage)
        power = voltage * np.conj(current)
        if self.kind == "gfl_reduced6":
            i_d, i_q, delta, xi_pll, xi_p, xi_q = x; vdq = voltage * np.exp(-1j * delta)
            delta_omega = 1.2 * vdq.imag + 5.0 * xi_pll; omega_pu = 1 + delta_omega / self.omega_b
            e_p, e_q = self.u0[0] - power.real, self.u0[1] - power.imag
            id_ref = 0.8 * e_p + 2.5 * xi_p; iq_ref = -(0.8 * e_q + 2.5 * xi_q)
            vtd = self.kp_i * (id_ref - i_d) + self.resistance * i_d - omega_pu * self.inductance * i_q + vdq.real
            vtq = self.kp_i * (iq_ref - i_q) + self.resistance * i_q + omega_pu * self.inductance * i_d + vdq.imag
            did = (omega_pu * self.inductance * i_q - self.resistance * i_d + vtd - vdq.real) / (self.inductance / self.omega_b)
            diq = (-omega_pu * self.inductance * i_d - self.resistance * i_q + vtq - vdq.imag) / (self.inductance / self.omega_b)
            return np.array([did, diq, delta_omega, vdq.imag, e_p, e_q])
        if self.kind == "gfl_rms10":
            delta, xi_pll, p_f, q_f, xi_p, xi_q, xi_id, xi_iq, i_d, i_q = x
            vdq = voltage * np.exp(-1j * delta); vd, vq = vdq.real, vdq.imag
            delta_omega = 920.0 * vq + 42320.0 * xi_pll; omega_pu = 1 + delta_omega
            e_p, e_q = self.u0[0] - p_f, self.u0[1] - q_f
            denominator = vd * vd + vq * vq
            id_ref = e_p + 20.0 * xi_p + (vd * self.u0[0] + vq * self.u0[1]) / denominator
            iq_ref = -(e_q + 20.0 * xi_q) + (vq * self.u0[0] - vd * self.u0[1]) / denominator
            magnitude = np.hypot(id_ref, iq_ref)
            if magnitude > 1.2:
                id_ref = np.clip(id_ref, -1.2, 1.2)
                iq_ref = np.clip(iq_ref, -np.sqrt(max(0.0, 1.2**2-id_ref**2)), np.sqrt(max(0.0, 1.2**2-id_ref**2)))
            e_d, e_iq = id_ref - i_d, iq_ref - i_q
            kp_current = (self.inductance / self.omega_b) / 0.002
            vtd = kp_current * e_d + 10.0 * xi_id + self.resistance * i_d - omega_pu * self.inductance * i_q + vd
            vtq = kp_current * e_iq + 10.0 * xi_iq + self.resistance * i_q + omega_pu * self.inductance * i_d + vq
            voltage_command = np.hypot(vtd, vtq)
            if voltage_command > 1.3:
                vtd *= 1.3 / voltage_command; vtq *= 1.3 / voltage_command
            did = (omega_pu*self.inductance*i_q-self.resistance*i_d+vtd-vd)/(self.inductance/self.omega_b)
            diq = (-omega_pu*self.inductance*i_d-self.resistance*i_q+vtq-vq)/(self.inductance/self.omega_b)
            return np.array([self.omega_b*delta_omega, vq, (power.real-p_f)/0.02,
                             (power.imag-q_f)/0.02, e_p, e_q, e_d, e_iq, did, diq])
        if self.kind == "gfm_no_pll":
            delta, speed, p_f, q_f = x
            return np.array([
                self.omega_b * speed,
                (self.u0[0] - p_f - 20.0 * speed) / 10.0,
                (power.real - p_f) / 0.01,
                (power.imag - q_f) / 0.01,
            ])
        i_d, i_q, omega, delta, emf, xi_v = x; vdq = voltage * np.exp(-1j * delta)
        domega = (self.u0[0] - power.real - 1.5 * (omega - 1)) / 0.08
        demf = (0.25 * (self.u0[1] - power.imag) - 8.0 * (emf - abs(voltage))) / 0.05
        e_vd, e_vq = emf - vdq.real, -vdq.imag
        iq_ref = -(1.2 * e_vd + 4.5 * xi_v); id_ref = 1.2 * e_vq
        vtd = self.kp_i * (id_ref - i_d) + self.resistance * i_d - omega * self.inductance * i_q + vdq.real
        vtq = self.kp_i * (iq_ref - i_q) + self.resistance * i_q + omega * self.inductance * i_d + vdq.imag
        did = (omega * self.inductance * i_q - self.resistance * i_d + vtd - vdq.real) / (self.inductance / self.omega_b)
        diq = (-omega * self.inductance * i_d - self.resistance * i_q + vtq - vdq.imag) / (self.inductance / self.omega_b)
        return np.array([did, diq, domega, self.omega_b * (omega - 1), demf, e_vd])


def _network(device: _SmibDevice, x: np.ndarray, y: np.ndarray, v_inf: complex, impedance: complex) -> np.ndarray:
    voltage = complex(y[0], y[1])
    mismatch = device.current(x, voltage) - (voltage - v_inf) / impedance
    return np.array([mismatch.real, mismatch.imag])


def _jacobians(device: _SmibDevice, x: np.ndarray, y: np.ndarray, v_inf: complex, impedance: complex, h: float):
    nx = device.x0.size
    fx = np.zeros((nx, nx)); fy = np.zeros((nx, 2)); gx = np.zeros((2, nx)); gy = np.zeros((2, 2))
    for j in range(nx):
        xp=x.copy(); xm=x.copy(); xp[j]+=h; xm[j]-=h
        fx[:,j]=(device.rhs(xp,y)-device.rhs(xm,y))/(2*h)
        gx[:,j]=(_network(device,xp,y,v_inf,impedance)-_network(device,xm,y,v_inf,impedance))/(2*h)
    for j in range(2):
        yp=y.copy(); ym=y.copy(); yp[j]+=h; ym[j]-=h
        fy[:,j]=(device.rhs(x,yp)-device.rhs(x,ym))/(2*h)
        gy[:,j]=(_network(device,x,yp,v_inf,impedance)-_network(device,x,ym,v_inf,impedance))/(2*h)
    return fx,fy,gx,gy


def _solve_voltage(device: _SmibDevice, x: np.ndarray, seed: np.ndarray, v_inf: complex, impedance: complex, opt: IbrOptions) -> np.ndarray:
    y=seed.copy()
    for _ in range(opt.newton_max_iterations):
        r=_network(device,x,y,v_inf,impedance)
        if np.max(np.abs(r)) <= opt.newton_tolerance: return y
        jac=np.zeros((2,2))
        for j in range(2):
            yp=y.copy();ym=y.copy();yp[j]+=opt.fd_eps;ym[j]-=opt.fd_eps
            jac[:,j]=(_network(device,x,yp,v_inf,impedance)-_network(device,x,ym,v_inf,impedance))/(2*opt.fd_eps)
        y += np.linalg.solve(jac,-r)
    raise PowerFlowError("ibr_algebraic", "IBR algebraic voltage solve did not converge.")


def _integrate(device: _SmibDevice, x0: np.ndarray, y0: np.ndarray, v_inf: complex, impedance: complex, opt: IbrOptions):
    nx=device.x0.size; steps=int(round(opt.t_end/opt.dt)); time=np.arange(steps+1)*opt.dt
    states=np.zeros((steps+1,nx)); voltage=np.zeros((steps+1,2)); residuals=np.zeros(steps)
    states[0]=x0;voltage[0]=y0
    for k in range(steps):
        old_x=states[k]; old_y=voltage[k]; f0=device.rhs(old_x,old_y); z=np.concatenate((old_x,old_y))
        for _ in range(opt.newton_max_iterations):
            x=z[:nx];y=z[nx:]; r=np.concatenate((x-old_x-0.5*opt.dt*(f0+device.rhs(x,y)),_network(device,x,y,v_inf,impedance)))
            nr=float(np.max(np.abs(r)))
            if nr <= opt.newton_tolerance: break
            jac=np.zeros((nx+2,nx+2))
            for j in range(nx+2):
                zp=z.copy();zm=z.copy();zp[j]+=opt.fd_eps;zm[j]-=opt.fd_eps
                def endpoint(value):
                    xx=value[:nx];yy=value[nx:]
                    return np.concatenate((xx-old_x-0.5*opt.dt*(f0+device.rhs(xx,yy)),_network(device,xx,yy,v_inf,impedance)))
                jac[:,j]=(endpoint(zp)-endpoint(zm))/(2*opt.fd_eps)
            z += np.linalg.solve(jac,-r)
        else: raise PowerFlowError("ibr_ts_newton", f"IBR step {k+1} did not converge.")
        states[k+1]=z[:nx];voltage[k+1]=z[nx:];residuals[k]=nr
    return time,states,voltage,residuals


def solve_reduced6_smib(case_id: str, options: IbrOptions | Mapping[str, Any] | None = None) -> IbrResult:
    opt=options if isinstance(options,IbrOptions) else IbrOptions.from_mapping(options)
    case_key=case_id.strip().lower(); kinds={
        "gfl_reduced6_smib":"gfl_reduced6", "gfm_reduced6_smib":"gfm_reduced6",
        "gfl_rms10_smib":"gfl_rms10", "gfm_no_pll_smib":"gfm_no_pll",
    }
    if case_key not in kinds: raise PowerFlowError("ibr_case_not_implemented", f"IBR case {case_id!r} is not implemented yet.")
    kind=kinds[case_key]; names={"gfl_reduced6":"GFL 6-state reduced SMIB","gfm_reduced6":"GFM 6-state reduced VSG SMIB",
                                "gfl_rms10":"GFL RMS10 SMIB", "gfm_no_pll":"GFM VSG no-PLL SMIB"}
    terminal=1+0j;p=0.4;q=0.1;impedance=0.02+0.20j;device=_SmibDevice(kind,terminal,p,q)
    y0=np.array([terminal.real,terminal.imag])
    current=device.current(device.x0, terminal);v_inf=terminal-impedance*current
    f0=device.rhs(device.x0,y0);g0=_network(device,device.x0,y0,v_inf,impedance);power=terminal*np.conj(current)
    fx=fy=gx=gy=matrix=eigenvalues=None;status=None
    if opt.ibr_analysis in {"sssa","ts","full"}:
        fx,fy,gx,gy=_jacobians(device,device.x0,y0,v_inf,impedance,opt.fd_eps)
        matrix=fx-fy@np.linalg.solve(gy,gx);eigenvalues=np.linalg.eigvals(matrix)
        status="UNSTABLE" if np.any(eigenvalues.real>1e-7) else ("MARGINAL" if np.any(np.abs(eigenvalues.real)<=1e-7) else "ASYMPTOTICALLY STABLE")
    time=drift=drift_v=perturbed=perturbed_v=residuals=None;max_drift=None
    if opt.ibr_analysis in {"ts","full"}:
        time,drift,drift_v,residuals=_integrate(device,device.x0,y0,v_inf,impedance,opt)
        perturb_index = 1 if kind == "gfm_no_pll" and opt.perturb_state == 3 else opt.perturb_state - 1
        if perturb_index >= device.x0.size:
            raise PowerFlowError("ibr_perturbation", "Perturbation state exceeds the device order.")
        xp=device.x0.copy();xp[perturb_index]+=opt.perturb_amplitude;yp=_solve_voltage(device,xp,y0,v_inf,impedance,opt)
        _,perturbed,perturbed_v,_=_integrate(device,xp,yp,v_inf,impedance,opt)
        max_drift=float(np.max(np.abs(drift[-1]-device.x0)))
    converged=bool(np.max(np.abs(f0))<1e-9 and np.max(np.abs(g0))<1e-9 and (residuals is None or np.all(residuals<=opt.newton_tolerance)))
    return IbrResult(case_key,names[kind],kind,opt.ibr_analysis,converged,device.state_names,device.x0.copy(),y0,device.u0.copy(),v_inf,impedance,f0,g0,power,fx,fy,gx,gy,matrix,eigenvalues,status,time,drift,drift_v,perturbed,perturbed_v,max_drift,residuals,MappingProxyType({"classification":"ASSUMED_DIAGNOSTIC_SOURCE_FROZEN_FIXTURE","method_source":"project-owned DAE Schur and coupled trapezoidal Newton","fallback_used":False}))
