"""Two identical reduced-six IBRs with AGSI++ mode switching at one PCC."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np

from power_flow.contracts import PowerFlowError
from power_flow.ibr.reduced6 import _SmibDevice


@dataclass(frozen=True, slots=True)
class TwoIbrSwitchOptions:
    ibr_analysis: str = "full"
    t_end: float = 8.0
    dt: float = 1e-3
    p_ref: float = 0.20
    q_ref: float = 0.0
    v_inf: complex = 1+0j
    z_line: complex = 0.30j
    agsi_up: float = 0.65
    agsi_down: float = 0.35
    event_time: float = 1.5
    recover_time: float = 4.0
    zline_factor: float = 4.0
    step_dphase_deg: float = 0.0
    step_dv: float = 0.0
    step_ramp: float = 0.40
    newton_tolerance: float = 1e-9
    newton_max_iterations: int = 80
    fd_eps: float = 1e-6

    def __post_init__(self) -> None:
        if self.ibr_analysis.strip().lower() not in {"ts","full"}:
            raise PowerFlowError("ibr_analysis","two_ibr_switch supports ts or full.")
        object.__setattr__(self,"ibr_analysis",self.ibr_analysis.strip().lower())
        if self.t_end <= 0 or self.dt <= 0 or self.step_ramp < 0:
            raise PowerFlowError("ibr_switch_options","Invalid switching time options.")
        if self.agsi_down >= self.agsi_up:
            raise PowerFlowError("ibr_switch_options","AGSI_down must be below AGSI_up.")
        if abs(self.z_line) == 0 or self.zline_factor <= 0 or self.step_dv <= -1:
            raise PowerFlowError("ibr_switch_options","Invalid switching grid parameters.")

    @classmethod
    def from_mapping(cls,value: Mapping[str,Any] | None) -> "TwoIbrSwitchOptions":
        if value is None: return cls()
        ignored={"plot_results","plot_visible","verbose"}; aliases={
            "two_ibr_P_ref":"p_ref","two_ibr_Q_ref":"q_ref","two_ibr_V_inf":"v_inf",
            "two_ibr_Z_line":"z_line","two_ibr_AGSI_up":"agsi_up",
            "two_ibr_AGSI_down":"agsi_down","two_ibr_event_time":"event_time",
            "two_ibr_recover_time":"recover_time","two_ibr_Zline_factor":"zline_factor",
            "two_ibr_step_dphase_deg":"step_dphase_deg","two_ibr_step_dV":"step_dv",
            "two_ibr_step_ramp":"step_ramp",
        }
        resolved={aliases.get(k,k):v for k,v in value.items() if k not in ignored}
        unknown=sorted(set(resolved)-set(cls.__dataclass_fields__))
        if unknown: raise PowerFlowError("unknown_ibr_options",f"Unknown two-IBR options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class TwoIbrSwitchResult:
    case_id: str; system_name: str; product: str; converged: bool
    time: np.ndarray; state1: np.ndarray; state2: np.ndarray; voltage: np.ndarray
    frequency1: np.ndarray; frequency2: np.ndarray; index1: np.ndarray; index2: np.ndarray
    mode1: np.ndarray; mode2: np.ndarray; p1: np.ndarray; p2: np.ndarray
    q1: np.ndarray; q2: np.ndarray; switch_events: np.ndarray
    newton_residual: np.ndarray; final_mode1: str; final_mode2: str
    metadata: Mapping[str,Any]

    def summary(self) -> dict[str,Any]:
        return {
            "system_name":self.system_name,"analysis":"ibr","case_id":self.case_id,
            "product":self.product,"converged":self.converged,"devices":2,
            "states":12,"steps":int(self.time.size-1),
            "switch_transactions":int(self.switch_events.shape[0]),
            "device1_switches":int(np.sum(self.switch_events[:,1]==1)) if self.switch_events.size else 0,
            "device2_switches":int(np.sum(self.switch_events[:,1]==2)) if self.switch_events.size else 0,
            "final_modes":[self.final_mode1,self.final_mode2],"peak_agsi":float(np.max(self.index1)),
            "fallback_used":False,
        }


class _Supervisor:
    def __init__(self,voltage: complex,p_ref: float,q_ref: float,up: float,down: float) -> None:
        self.mode="gfl";self.device=_SmibDevice("gfl_reduced6",voltage,p_ref,q_ref)
        self.p_ref0=p_ref;self.q_ref0=q_ref;self.up=up;self.down=down
        self.f_prev=np.nan;self.t_prev=np.nan;self.rocof_filt=np.nan
        self.up_since=np.nan;self.down_since=np.nan;self.mode_entry_time=0.0
        self.n_switch=0;self.grid_scr=1e6

    def rhs(self,x: np.ndarray,y: np.ndarray) -> np.ndarray: return self.device.rhs(x,y)
    def current(self,x: np.ndarray,y: np.ndarray) -> complex:
        return self.device.current(x,complex(y[0],y[1]))

    def signals(self,x: np.ndarray,y: np.ndarray) -> tuple[float,float,float,float]:
        voltage=complex(y[0],y[1]);current=self.current(x,y);power=voltage*np.conj(current)
        if self.mode=="gfl":
            vdq=voltage*np.exp(-1j*x[2]);delta_omega=1.2*vdq.imag+5.0*x[3]
            frequency=60+delta_omega/(2*np.pi);lock=abs(vdq.imag)/0.10
        else:
            frequency=60*x[2];lock=abs((voltage*np.exp(-1j*x[3])).imag)/0.10
        return frequency,float(power.real),float(power.imag),lock

    def index(self,x: np.ndarray,y: np.ndarray,t: float,update: bool) -> float:
        frequency,power,_,lock=self.signals(x,y);voltage=abs(complex(y[0],y[1]))
        have_prev=np.isfinite(self.f_prev) and np.isfinite(self.t_prev) and t>self.t_prev
        raw=(frequency-self.f_prev)/(t-self.t_prev) if have_prev else 0.0
        if not np.isfinite(self.rocof_filt): filtered=raw
        elif have_prev: filtered=self.rocof_filt+min(1.0,(t-self.t_prev)/0.05)*(raw-self.rocof_filt)
        else: filtered=self.rocof_filt
        j_scr=max(0.0,3.0/max(self.grid_scr,1e-9)-1.0)
        value=(0.25*abs(voltage-1)/0.10+0.25*abs(frequency-60)/0.50+
               0.15*abs(filtered)/1.0+0.10*abs(self.device.u0[0]-power)/0.20+
               0.15*j_scr+0.10*lock)
        if update:
            self.f_prev=frequency;self.t_prev=t;self.rocof_filt=filtered
        return float(value)

    def maybe_switch(self,x: np.ndarray,y: np.ndarray,t: float) -> tuple[np.ndarray,bool,float,str]:
        value=self.index(x,y,t,True);target=""
        if self.mode=="gfl":
            self.up_since=t if value>=self.up and not np.isfinite(self.up_since) else self.up_since
            if value<self.up: self.up_since=np.nan
            if np.isfinite(self.up_since) and t-self.up_since>=0: target="GFM"
        else:
            self.down_since=t if value<self.down and not np.isfinite(self.down_since) else self.down_since
            if value>=self.down: self.down_since=np.nan
            if np.isfinite(self.down_since) and t-self.down_since>=0: target="gfl"
        if not target: return x,False,value,self.mode
        voltage=complex(y[0],y[1]);power=voltage*np.conj(self.current(x,y))
        kind="gfm_reduced6" if target=="GFM" else "gfl_reduced6"
        self.device=_SmibDevice(kind,voltage,float(power.real),float(power.imag))
        self.mode=target;self.mode_entry_time=t;self.up_since=np.nan;self.down_since=np.nan;self.n_switch+=1
        return self.device.x0.copy(),True,value,target


def _pcc_equilibrium(v_inf: complex,z_line: complex,p_total: float,q_total: float) -> complex:
    y=np.array([v_inf.real,v_inf.imag],dtype=float)
    for _ in range(50):
        voltage=complex(y[0],y[1]);current=np.conj(complex(p_total,q_total)/voltage)
        mismatch=current-(voltage-v_inf)/z_line;r=np.array([mismatch.real,mismatch.imag])
        if np.max(np.abs(r))<1e-12:return voltage
        jac=np.zeros((2,2))
        for j in range(2):
            yp=y.copy();ym=y.copy();yp[j]+=1e-6;ym[j]-=1e-6
            def f(value):
                v=complex(value[0],value[1]);m=np.conj(complex(p_total,q_total)/v)-(v-v_inf)/z_line
                return np.array([m.real,m.imag])
            jac[:,j]=(f(yp)-f(ym))/2e-6
        y+=np.linalg.solve(jac,-r)
    raise PowerFlowError("ibr_switch_equilibrium","Two-IBR PCC equilibrium did not converge.")


def _ramp(t: float,on: float,off: float,ramp: float) -> float:
    if t<on:return 0.0
    if ramp<=0:return float(on<=t<off)
    if t<on+ramp:
        u=(t-on)/ramp;return 3*u*u-2*u*u*u
    if t<off:return 1.0
    if t<off+ramp:
        u=(t-off)/ramp;return 1-(3*u*u-2*u*u*u)
    return 0.0


def solve_two_ibr_switch(case_id: str,options: TwoIbrSwitchOptions | Mapping[str,Any] | None=None) -> TwoIbrSwitchResult:
    if case_id.strip().lower()!="two_ibr_switch":
        raise PowerFlowError("ibr_case_not_implemented",f"IBR switching case {case_id!r} is not implemented.")
    opt=options if isinstance(options,TwoIbrSwitchOptions) else TwoIbrSwitchOptions.from_mapping(options)
    vpcc=_pcc_equilibrium(opt.v_inf,opt.z_line,2*opt.p_ref,2*opt.q_ref)
    supervisor=_Supervisor(vpcc,opt.p_ref,opt.q_ref,opt.agsi_up,opt.agsi_down)
    x0=supervisor.device.x0.copy();y0=np.array([vpcc.real,vpcc.imag]);steps=int(round(opt.t_end/opt.dt))
    time=np.arange(steps+1)*opt.dt;states=np.zeros((steps+1,6));voltage=np.zeros((steps+1,2));residuals=np.zeros(steps)
    frequency=np.zeros(steps+1);index=np.zeros(steps+1);mode=np.zeros(steps+1);p=np.zeros(steps+1);q=np.zeros(steps+1)
    states[0]=x0;voltage[0]=y0;frequency[0],p[0],q[0],_=supervisor.signals(x0,y0);index[0]=supervisor.index(x0,y0,0,False)
    events=[]
    for k in range(steps):
        t1=time[k+1];weight=_ramp(t1,opt.event_time,opt.recover_time,opt.step_ramp)
        v_step=opt.v_inf*(1+opt.step_dv)*np.exp(1j*np.deg2rad(opt.step_dphase_deg))
        v_inf=opt.v_inf+(v_step-opt.v_inf)*weight;z_line=opt.z_line*(1+(opt.zline_factor-1)*weight)
        supervisor.grid_scr=abs(v_inf)**2/(abs(z_line)*(2*abs(opt.p_ref)+1e-9))
        old_x=states[k];old_y=voltage[k];f0=supervisor.rhs(old_x,old_y);z=np.concatenate((old_x,old_y))
        def endpoint(value):
            x=value[:6];y=value[6:];v=complex(y[0],y[1]);mis=2*supervisor.current(x,y)-(v-v_inf)/z_line
            return np.concatenate((x-old_x-0.5*opt.dt*(f0+supervisor.rhs(x,y)),[mis.real,mis.imag]))
        for _ in range(opt.newton_max_iterations):
            r=endpoint(z);nr=float(np.max(np.abs(r)))
            if nr<=opt.newton_tolerance:break
            jac=np.zeros((8,8));r0=r
            for j in range(8):
                zp=z.copy();zp[j]+=opt.fd_eps;jac[:,j]=(endpoint(zp)-r0)/opt.fd_eps
            z+=np.linalg.solve(jac,-r)
        else:raise PowerFlowError("ibr_switch_newton",f"Two-IBR step {k+1} did not converge.")
        states[k+1]=z[:6];voltage[k+1]=z[6:];residuals[k]=nr
        frequency[k+1],p[k+1],q[k+1],_=supervisor.signals(states[k+1],voltage[k+1])
        index[k+1]=supervisor.index(states[k+1],voltage[k+1],t1,False);mode[k+1]=float(supervisor.mode!="gfl")
        switched,did,value,target=supervisor.maybe_switch(states[k+1],voltage[k+1],t1)
        if did:
            states[k+1]=switched;flag=float(target=="GFM")
            events.extend(((t1,1,value,flag),(t1,2,value,flag)))
    event_array=np.asarray(events,dtype=float).reshape((-1,4))
    return TwoIbrSwitchResult(
        "two_ibr_switch","Two GFL IBRs - AGSI++ GFL/GFM switch",opt.ibr_analysis,
        bool(np.all(residuals<=opt.newton_tolerance)),time,states,states.copy(),voltage,
        frequency,frequency.copy(),index,index.copy(),mode,mode.copy(),p,p.copy(),q,q.copy(),
        event_array,residuals,supervisor.mode,supervisor.mode,
        MappingProxyType({"classification":"ASSUMED_DIAGNOSTIC_TWO_IBR_AGSI_SWITCH",
                          "method_source":"project-owned symmetric coupled trapezoidal Newton",
                          "fallback_used":False}),
    )
