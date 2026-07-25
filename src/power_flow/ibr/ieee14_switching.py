"""IEEE-14 one-SG/four-IBR AGSI++ switching study.

This is a project-owned transcription of the active MATLAB study.  NumPy and
SciPy are used only for numerical primitives; no packaged power-system solver
is used.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np

from power_flow.cases import ieee14
from power_flow.contracts import PowerFlowError, PowerFlowOptions
from power_flow.ibr.reduced6 import _SmibDevice
from power_flow.network import prepare_case
from power_flow.pf import solve_newton_raphson


@dataclass(frozen=True, slots=True)
class Ieee14SwitchOptions:
    ibr_analysis: str = "full"
    index_mode: str = "agsi_pp"
    sg_trip_time: float = 1.0
    sg_reclose_time: float = 4.0
    t_end: float = 10.0
    dt: float = 2e-3
    agsi_up: float = 0.65
    agsi_down: float = 0.35
    newton_tolerance: float = 1e-8
    newton_max_iterations: int = 40
    fd_eps: float = 1e-6

    def __post_init__(self) -> None:
        product = self.ibr_analysis.strip().lower()
        mode = self.index_mode.strip().lower()
        if product not in {"pf", "sssa", "ts", "full"}:
            raise PowerFlowError("ibr_analysis", "ieee14_switch supports pf, sssa, ts, or full.")
        if mode not in {"agsi", "agsi_pp"}:
            raise PowerFlowError("ieee14_index_mode", "index_mode must be agsi or agsi_pp.")
        if self.t_end <= 0 or self.dt <= 0 or self.sg_reclose_time <= self.sg_trip_time:
            raise PowerFlowError("ieee14_switch_options", "Invalid switching time options.")
        if self.agsi_down >= self.agsi_up:
            raise PowerFlowError("ieee14_switch_options", "agsi_down must be below agsi_up.")
        object.__setattr__(self, "ibr_analysis", product)
        object.__setattr__(self, "index_mode", mode)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "Ieee14SwitchOptions":
        if value is None:
            return cls()
        aliases = {
            "ieee14_index_mode": "index_mode",
            "ieee14_sg_trip_time": "sg_trip_time",
            "ieee14_sg_reclose_time": "sg_reclose_time",
        }
        ignored = {"plot_results", "plot_visible", "verbose"}
        resolved = {aliases.get(k, k): v for k, v in value.items() if k not in ignored}
        unknown = sorted(set(resolved) - set(cls.__dataclass_fields__))
        if unknown:
            raise PowerFlowError("unknown_ibr_options", f"Unknown IEEE14-switch options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class Ieee14SwitchResult:
    case_id: str
    system_name: str
    product: str
    converged: bool
    bus_ids: np.ndarray
    pf_voltage: np.ndarray
    pf_angle_deg: np.ndarray
    state_matrix: np.ndarray
    eigenvalues: np.ndarray
    time: np.ndarray | None
    state: np.ndarray | None
    bus_voltage: np.ndarray | None
    frequency_ibr: np.ndarray | None
    index: np.ndarray | None
    mode: np.ndarray | None
    p_ibr: np.ndarray | None
    q_ibr: np.ndarray | None
    v_min: np.ndarray | None
    sg_online: np.ndarray | None
    switch_events: np.ndarray
    final_modes: tuple[str, ...]
    newton_residual: np.ndarray | None
    metadata: Mapping[str, Any]

    def summary(self) -> dict[str, Any]:
        return {
            "system_name": self.system_name,
            "analysis": "ibr",
            "case_id": self.case_id,
            "product": self.product,
            "converged": self.converged,
            "devices": 5,
            "states": int(self.state_matrix.shape[0]),
            "small_signal_unstable_modes": int(np.sum(self.eigenvalues.real > 1e-6)),
            "max_real_eigenvalue": float(np.max(self.eigenvalues.real)),
            "steps": 0 if self.time is None else int(self.time.size - 1),
            "switch_transactions": int(self.switch_events.shape[0]),
            "final_modes": list(self.final_modes),
            "fallback_used": False,
        }


class _ManualSg:
    """Kodsi Gen1 data mapped to the four-state Padiyar model 1.1."""

    def __init__(self, voltage: complex, p: float, q: float) -> None:
        scale_z = 100.0 / 615.0
        scale_h = 615.0 / 100.0
        self.ra = 0.0
        self.xd = 0.8979 * scale_z
        self.xdp = 0.2995 * scale_z
        self.xq = 0.646 * scale_z
        self.xqp = self.xq
        self.tpd0 = 7.4
        self.tpq0 = 0.033
        self.h = 5.148 * scale_h
        self.d = 2.0 * scale_h
        self.r = 0.05
        self.omega_b = 2 * np.pi * 60.0
        self.q0 = q
        current = np.conj(complex(p, q) / voltage)
        delta = np.angle(voltage + complex(self.ra, self.xq) * current)
        i_d, i_q = _to_dq(current, delta)
        v_d, v_q = _to_dq(voltage, delta)
        e_dp = (self.xq - self.xqp) * i_q
        e_qp = v_q + self.ra * i_q + self.xdp * i_d
        self.efd0 = e_qp + (self.xd - self.xdp) * i_d
        self.pm = v_d * i_d + v_q * i_q + self.ra * (i_d * i_d + i_q * i_q)
        self.x0 = np.array([delta, 1.0, e_qp, e_dp])

    def stator(self, x: np.ndarray, voltage: complex) -> tuple[float, float, float, float]:
        v_d, v_q = _to_dq(voltage, x[0])
        rd, rq = v_d - x[3], v_q - x[2]
        den = self.ra**2 + self.xdp * self.xqp
        i_d = (-self.ra * rd - self.xqp * rq) / den
        i_q = (self.xdp * rd - self.ra * rq) / den
        return i_d, i_q, v_d, v_q

    def current(self, x: np.ndarray, voltage: complex) -> complex:
        i_d, i_q, _, _ = self.stator(x, voltage)
        return _from_dq(i_d, i_q, x[0])

    def rhs(self, x: np.ndarray, voltage: complex) -> np.ndarray:
        i_d, i_q, v_d, v_q = self.stator(x, voltage)
        omega, e_qp, e_dp = x[1:]
        torque = v_d * i_d + v_q * i_q + self.ra * (i_d*i_d + i_q*i_q)
        pm_eff = self.pm - (omega - 1.0) / self.r
        return np.array([
            self.omega_b * (omega - 1.0),
            (pm_eff - torque - self.d * (omega - 1.0)) / (2*self.h),
            (self.efd0 - e_qp - (self.xd-self.xdp)*i_d) / self.tpd0,
            (-e_dp + (self.xq-self.xqp)*i_q) / self.tpq0,
        ])

    def reinitialize(self, voltage: complex) -> np.ndarray:
        current = np.conj(complex(self.pm, self.q0) / voltage)
        delta = np.angle(voltage + complex(self.ra, self.xq) * current)
        for _ in range(60):
            i_d, i_q = _to_dq(current, delta); v_d, _ = _to_dq(voltage, delta)
            residual = v_d + self.ra*i_d - self.xq*i_q
            if abs(residual) < 1e-12:
                break
            h = 1e-7
            idp, iqp = _to_dq(current, delta+h); vdp, _ = _to_dq(voltage, delta+h)
            delta -= residual / ((vdp+self.ra*idp-self.xq*iqp-residual)/h)
        i_d, i_q = _to_dq(current, delta); _, v_q = _to_dq(voltage, delta)
        return np.array([delta, 1.0, v_q+self.ra*i_q+self.xdp*i_d,
                         (self.xq-self.xqp)*i_q])


class _ScaledSupervisor:
    def __init__(self, voltage: complex, p: float, q: float, rating: float,
                 mode: str, up: float, down: float) -> None:
        self.kappa = 1.0 / rating
        self.mode = "gfl"
        self.device = _SmibDevice("gfl_reduced6", voltage, self.kappa*p, self.kappa*q)
        self.p_ref0, self.q_ref0 = p, q
        self.p_ref, self.q_ref = p, q
        self.index_mode, self.up, self.down = mode, up, down
        self.grid_scr = 1e6
        self.f_prev = self.t_prev = self.rocof_filt = np.nan
        self.up_since = self.down_since = np.nan
        self.mode_entry_time = 0.0
        self.n_switch = 0
        self.current_limit = 1.2 * rating

    @property
    def x0(self) -> np.ndarray:
        return self.device.x0.copy()

    def current(self, x: np.ndarray, voltage: complex) -> complex:
        value = self.raw_current(x, voltage)
        magnitude = abs(value)
        return value if magnitude <= self.current_limit else value*(self.current_limit/magnitude)

    def raw_current(self, x: np.ndarray, voltage: complex) -> complex:
        return self.device.current(x, voltage) / self.kappa

    def rhs(self, x: np.ndarray, voltage: complex) -> np.ndarray:
        return self.device.rhs(x, np.array([voltage.real, voltage.imag]))

    def signals(self, x: np.ndarray, voltage: complex) -> tuple[float, float, float, float]:
        # MATLAB reconstruct() reports the active branch's unconstrained power;
        # the separate network-injection path applies the converter limiter.
        power = voltage*np.conj(self.raw_current(x, voltage))
        if self.mode == "gfl":
            vdq = voltage*np.exp(-1j*x[2]); dw = 1.2*vdq.imag+5.0*x[3]
            frequency, lock = 60+dw/(2*np.pi), abs(vdq.imag)/0.10
        else:
            frequency, lock = 60*x[2], abs((voltage*np.exp(-1j*x[3])).imag)/0.10
        return frequency, float(power.real), float(power.imag), lock

    def index(self, x: np.ndarray, voltage: complex, t: float, update: bool) -> float:
        frequency, power, _, lock = self.signals(x, voltage)
        have = np.isfinite(self.f_prev) and np.isfinite(self.t_prev) and t > self.t_prev
        raw = (frequency-self.f_prev)/(t-self.t_prev) if have else 0.0
        if self.index_mode == "agsi_pp":
            if not np.isfinite(self.rocof_filt): filtered = raw
            elif have: filtered = self.rocof_filt+min(1.0,(t-self.t_prev)/0.05)*(raw-self.rocof_filt)
            else: filtered = self.rocof_filt
            weights = (0.25,0.25,0.15,0.10,0.15,0.10)
        else:
            filtered, weights = raw, (0.30,0.30,0.25,0.15,0.0,0.0)
        j_scr = max(0.0, 3.0/max(self.grid_scr,1e-9)-1.0)
        value = (weights[0]*abs(abs(voltage)-1)/0.10 + weights[1]*abs(frequency-60)/0.50 +
                 weights[2]*abs(filtered) + weights[3]*abs(self.p_ref-power)/0.20 +
                 weights[4]*j_scr + weights[5]*lock)
        if update:
            self.f_prev, self.t_prev, self.rocof_filt = frequency, t, filtered
        return float(value)

    def switch(self, x: np.ndarray, voltage: complex, t: float) -> tuple[np.ndarray, bool, float]:
        value = self.index(x, voltage, t, True)
        target = ""
        if self.mode == "gfl":
            self.up_since = t if value >= self.up and not np.isfinite(self.up_since) else self.up_since
            if value < self.up: self.up_since = np.nan
            if np.isfinite(self.up_since): target = "GFM"
        else:
            self.down_since = t if value < self.down and not np.isfinite(self.down_since) else self.down_since
            if value >= self.down: self.down_since = np.nan
            if np.isfinite(self.down_since): target = "gfl"
        if not target:
            return x, False, value
        power = voltage*np.conj(self.current(x, voltage))
        kind = "gfm_reduced6" if target == "GFM" else "gfl_reduced6"
        self.device = _SmibDevice(kind, voltage, self.kappa*power.real, self.kappa*power.imag)
        self.mode = target
        self.p_ref = float(power.real)
        self.q_ref = float(self.device.u0[1]/self.kappa)
        self.up_since = self.down_since = np.nan
        self.mode_entry_time = t
        self.n_switch += 1
        return self.device.x0.copy(), True, value

    def restore(self, voltage: complex, t: float) -> np.ndarray:
        self.device = _SmibDevice("gfl_reduced6", voltage,
                                  self.kappa*self.p_ref0, self.kappa*self.q_ref0)
        if self.mode != "gfl": self.n_switch += 1
        self.mode, self.p_ref, self.q_ref = "gfl", self.p_ref0, self.q_ref0
        self.f_prev = self.t_prev = self.rocof_filt = np.nan
        self.up_since = self.down_since = np.nan
        self.mode_entry_time = t
        return self.device.x0.copy()


def _to_dq(value: complex, delta: float) -> tuple[float, float]:
    return (np.sin(delta)*value.real-np.cos(delta)*value.imag,
            np.cos(delta)*value.real+np.sin(delta)*value.imag)


def _from_dq(i_d: float, i_q: float, delta: float) -> complex:
    return complex(np.sin(delta)*i_d+np.cos(delta)*i_q,
                   -np.cos(delta)*i_d+np.sin(delta)*i_q)


@dataclass(slots=True)
class _System:
    bus_ids: np.ndarray
    y: np.ndarray
    y0: np.ndarray
    sg: _ManualSg
    devices: list[_ScaledSupervisor]
    x0: np.ndarray
    sg_position: int
    ibr_positions: np.ndarray
    scr_bus: np.ndarray
    pf: Any


def _build_system(opt: Ieee14SwitchOptions) -> _System:
    case = ieee14()
    pf = solve_newton_raphson(case, PowerFlowOptions(
        tolerance=1e-10, max_iter=100, enforce_q_limits=False,
    ))
    if not pf.converged:
        raise PowerFlowError("ieee14_switch_pf", "IEEE14 initialization power flow did not converge.")
    model = prepare_case(case)
    voltage = pf.bus_voltage*np.exp(1j*pf.bus_angle)
    load_admittance = (pf.p_load-1j*pf.q_load)/(np.abs(voltage)**2)
    dynamic_y = model.ybus+np.diag(load_admittance)
    y0 = np.empty(2*voltage.size)
    y0[0::2], y0[1::2] = voltage.real, voltage.imag
    sg_position = int(np.flatnonzero(pf.external_bus_ids == 1)[0])
    sg = _ManualSg(voltage[sg_position], pf.p_generation[sg_position], pf.q_generation[sg_position])
    positions = np.array([int(np.flatnonzero(pf.external_bus_ids == b)[0]) for b in (2,3,6,8)])
    zbus = np.linalg.inv(dynamic_y)
    devices: list[_ScaledSupervisor] = []
    scr = np.zeros(4)
    states = [sg.x0]
    for position in positions:
        p, q = pf.p_generation[position], pf.q_generation[position]
        rating = max(abs(complex(p,q)), 0.20)
        device = _ScaledSupervisor(voltage[position], p, q, rating,
                                   opt.index_mode, opt.agsi_up, opt.agsi_down)
        devices.append(device); states.append(device.x0)
        scr[len(devices)-1] = abs(voltage[position])**2/(abs(zbus[position,position])*rating)
    return _System(np.array(pf.external_bus_ids), dynamic_y, y0, sg, devices,
                   np.concatenate(states), sg_position, positions, scr, pf)


def _split_state(system: _System, x: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    return x[:4], [x[4+6*j:10+6*j] for j in range(4)]


def _composite(system: _System, x: np.ndarray, y: np.ndarray,
               sg_online: bool = True) -> tuple[np.ndarray, np.ndarray]:
    voltage = y[0::2]+1j*y[1::2]
    sg_x, ibr_x = _split_state(system, x)
    differential: list[np.ndarray] = []
    current_balance = -system.y@voltage
    if sg_online:
        differential.append(system.sg.rhs(sg_x, voltage[system.sg_position]))
        current_balance[system.sg_position] += system.sg.current(sg_x, voltage[system.sg_position])
    else:
        differential.append(np.zeros(4))
    for j, device in enumerate(system.devices):
        bus_voltage = voltage[system.ibr_positions[j]]
        differential.append(device.rhs(ibr_x[j], bus_voltage))
        current_balance[system.ibr_positions[j]] += device.current(ibr_x[j], bus_voltage)
    algebraic = np.empty(y.size)
    algebraic[0::2], algebraic[1::2] = current_balance.real, current_balance.imag
    return np.concatenate(differential), algebraic


def _linearize(system: _System, h: float = 1e-6) -> tuple[np.ndarray, np.ndarray]:
    z0 = np.concatenate((system.x0, system.y0)); nx = system.x0.size
    def equation(z: np.ndarray) -> np.ndarray:
        f, g = _composite(system, z[:nx], z[nx:])
        return np.concatenate((f,g))
    jacobian = np.zeros((z0.size,z0.size))
    for j in range(z0.size):
        zp=z0.copy(); zm=z0.copy(); zp[j]+=h; zm[j]-=h
        jacobian[:,j]=(equation(zp)-equation(zm))/(2*h)
    fx, fy = jacobian[:nx,:nx], jacobian[:nx,nx:]
    gx, gy = jacobian[nx:,:nx], jacobian[nx:,nx:]
    matrix = fx-fy@np.linalg.solve(gy,gx)
    return matrix, np.linalg.eigvals(matrix)


def _equilibrium_residual(system: _System) -> float:
    f,g = _composite(system,system.x0,system.y0)
    return float(max(np.max(np.abs(f)),np.max(np.abs(g))))


def _simulate(system: _System, opt: Ieee14SwitchOptions) -> tuple[Any,...]:
    nx, ny = system.x0.size, system.y0.size
    steps = int(round(opt.t_end/opt.dt)); time=np.arange(steps+1)*opt.dt
    state=np.zeros((steps+1,nx)); y=np.zeros((steps+1,ny))
    state[0],y[0]=system.x0,system.y0
    residual=np.zeros(steps); online=np.ones(steps+1,dtype=bool)
    frequency=np.zeros((steps+1,4)); index=np.zeros((steps+1,4)); mode=np.zeros((steps+1,4))
    p_ibr=np.zeros((steps+1,4)); q_ibr=np.zeros((steps+1,4)); v_min=np.zeros(steps+1)
    events: list[tuple[float,float,float,float]]=[]

    def record(k: int,t: float) -> None:
        voltage=y[k,0::2]+1j*y[k,1::2];v_min[k]=float(np.min(np.abs(voltage)))
        for j,device in enumerate(system.devices):
            vb=voltage[system.ibr_positions[j]]
            frequency[k,j],p_ibr[k,j],q_ibr[k,j],_=device.signals(state[k,4+6*j:10+6*j],vb)
            index[k,j]=device.index(state[k,4+6*j:10+6*j],vb,t,False)
            mode[k,j]=float(device.mode!="gfl")

    record(0,0.0); previous_online=True
    for k in range(steps):
        t1=time[k+1]
        is_online = bool(t1 < opt.sg_trip_time or t1 >= opt.sg_reclose_time)
        if is_online and not previous_online:
            voltage=y[k,0::2]+1j*y[k,1::2]
            state[k,:4]=system.sg.reinitialize(voltage[system.sg_position])
            for j,device in enumerate(system.devices):
                if device.mode != "gfl":
                    state[k,4+6*j:10+6*j]=device.restore(voltage[system.ibr_positions[j]],t1)
                    events.append((t1,float(j+1),np.nan,0.0))
        previous_online=is_online
        for j,device in enumerate(system.devices):
            device.grid_scr=20.0 if is_online else system.scr_bus[j]
        x_old=state[k].copy();y_old=y[k].copy()
        f_old,_=_composite(system,x_old,y_old,is_online)
        z=np.concatenate((x_old,y_old))

        def endpoint(value: np.ndarray) -> np.ndarray:
            x1,y1=value[:nx],value[nx:]
            f1,g1=_composite(system,x1,y1,is_online)
            differential=x1-x_old-0.5*opt.dt*(f_old+f1)
            if not is_online:
                differential[:4]=x1[:4]-x_old[:4]
            return np.concatenate((differential,g1))

        def jacobian(value: np.ndarray,r0: np.ndarray) -> np.ndarray:
            result=np.zeros((nx+ny,nx+ny))
            for column in range(nx+ny):
                trial=value.copy();trial[column]+=opt.fd_eps
                result[:,column]=(endpoint(trial)-r0)/opt.fd_eps
            return result

        converged=False; r=endpoint(z); nr=float(np.max(np.abs(r)))
        if nr > opt.newton_tolerance:
            jac=jacobian(z,r); rebuilt=False
            for _ in range(opt.newton_max_iterations):
                r=endpoint(z);nr=float(np.max(np.abs(r)))
                if nr <= opt.newton_tolerance:
                    converged=True;break
                try:
                    dz=np.linalg.solve(jac,-r)
                except np.linalg.LinAlgError:
                    if rebuilt: break
                    jac=jacobian(z,r);rebuilt=True;continue
                accepted=False;alpha=1.0
                for _ in range(16):
                    trial=z+alpha*dz
                    try: trial_norm=float(np.max(np.abs(endpoint(trial))))
                    except (FloatingPointError,PowerFlowError): trial_norm=np.inf
                    if np.all(np.isfinite(trial)) and trial_norm < nr:
                        z=trial;accepted=True;break
                    alpha*=0.5
                if not accepted:
                    if not rebuilt:
                        jac=jacobian(z,r);rebuilt=True
                        try: candidate=z-np.linalg.solve(jac,r)
                        except np.linalg.LinAlgError: break
                    else:
                        candidate=z+dz
                    candidate_norm=float(np.max(np.abs(endpoint(candidate))))
                    if np.all(np.isfinite(candidate)) and candidate_norm < 1e3*nr: z=candidate
                    else: break
            r=endpoint(z);nr=float(np.max(np.abs(r)));converged=converged or nr<=opt.newton_tolerance
        else:
            converged=True
        if not converged:
            raise PowerFlowError("ieee14_switch_newton",f"IEEE14 switching step {k+1} did not converge (residual {nr:.3e}).")
        state[k+1],y[k+1],residual[k],online[k+1]=z[:nx],z[nx:],nr,is_online
        record(k+1,t1)
        voltage=y[k+1,0::2]+1j*y[k+1,1::2]
        for j,device in enumerate(system.devices):
            sl=slice(4+6*j,10+6*j)
            switched,did,value=device.switch(state[k+1,sl],voltage[system.ibr_positions[j]],t1)
            if did:
                state[k+1,sl]=switched
                events.append((t1,float(j+1),value,float(device.mode=="GFM")))
    voltages=y[:,0::2]+1j*y[:,1::2]
    return (time,state,voltages,frequency,index,mode,p_ibr,q_ibr,v_min,online,
            np.asarray(events,dtype=float).reshape((-1,4)),residual,True)


def solve_ieee14_switch(
    case_id: str,
    options: Ieee14SwitchOptions | Mapping[str,Any] | None = None,
) -> Ieee14SwitchResult:
    if case_id.strip().lower() not in {"ieee14_switch", "ieee14_1sg_4ibr"}:
        raise PowerFlowError("ibr_case_not_implemented", f"IEEE14 switching case {case_id!r} is not implemented.")
    opt = options if isinstance(options,Ieee14SwitchOptions) else Ieee14SwitchOptions.from_mapping(options)
    system = _build_system(opt)
    initial_residual = _equilibrium_residual(system)
    if initial_residual > 1e-7:
        raise PowerFlowError("ieee14_switch_equilibrium", f"Composite equilibrium residual is {initial_residual:.3e}.")
    matrix,eigenvalues = _linearize(system,opt.fd_eps)
    time=state=bus_voltage=frequency=index=mode=p_ibr=q_ibr=v_min=sg_online=residual=None
    events=np.empty((0,4)); final_modes=tuple(device.mode for device in system.devices)
    converged = bool(np.sum(eigenvalues.real>1e-6)==0)
    if opt.ibr_analysis in {"ts","full"}:
        (time,state,bus_voltage,frequency,index,mode,p_ibr,q_ibr,v_min,sg_online,
         events,residual,converged) = _simulate(system,opt)
        final_modes=tuple(device.mode for device in system.devices)
    return Ieee14SwitchResult(
        "ieee14_switch", "IEEE 14-bus: one SG and four switchable IBRs", opt.ibr_analysis,
        converged, system.bus_ids, system.pf.bus_voltage, system.pf.bus_angle_deg,
        matrix,eigenvalues,time,state,bus_voltage,frequency,index,mode,p_ibr,q_ibr,
        v_min,sg_online,events,final_modes,residual,
        MappingProxyType({
            "classification":"ASSUMED_DIAGNOSTIC_IEEE14_1SG_4IBR_SWITCH",
            "schema_version":"ieee14_switch/1.0",
            "method_source":"project-owned composite DAE and implicit trapezoidal Newton",
            "initial_equilibrium_residual":initial_residual,
            "sg_bus":1,"ibr_buses":[2,3,6,8],"fallback_used":False,
        }),
    )
