"""Padiyar two-area one-SG/three-IBR AGSI++ switching study."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

import numpy as np

from power_flow.cases import load_case
from power_flow.contracts import PowerFlowError
from power_flow.ibr.ieee14_switching import (
    Ieee14SwitchResult,
    _ScaledSupervisor,
    _System,
    _equilibrium_residual,
    _from_dq,
    _linearize,
    _simulate,
    _to_dq,
)
from power_flow.sssa.padiyar import PadiyarDae, PadiyarOptions, build_padiyar_dae


@dataclass(frozen=True, slots=True)
class PadiyarSwitchOptions:
    ibr_analysis: str = "full"
    index_mode: str = "agsi_pp"
    sg_trip_time: float = 1.0
    sg_reclose_time: float = 4.0
    t_end: float = 8.0
    dt: float = 2e-3
    agsi_up: float = 0.65
    agsi_down: float = 0.35
    newton_tolerance: float = 1e-8
    newton_max_iterations: int = 40
    fd_eps: float = 1e-6
    stream_callback: Any = None
    cancel_check: Any = None
    stream_stride: int = 10

    def __post_init__(self) -> None:
        product=self.ibr_analysis.strip().lower();mode=self.index_mode.strip().lower()
        if product not in {"pf","sssa","ts","full"}:
            raise PowerFlowError("ibr_analysis","padiyar_switch supports pf, sssa, ts, or full.")
        if mode not in {"agsi","agsi_pp"}:
            raise PowerFlowError("padiyar_index_mode","index_mode must be agsi or agsi_pp.")
        if self.t_end<=0 or self.dt<=0 or self.sg_reclose_time<=self.sg_trip_time:
            raise PowerFlowError("padiyar_switch_options","Invalid switching time options.")
        if self.agsi_down>=self.agsi_up:
            raise PowerFlowError("padiyar_switch_options","agsi_down must be below agsi_up.")
        if self.stream_stride<1:raise PowerFlowError("padiyar_switch_options","stream_stride must be positive.")
        object.__setattr__(self,"ibr_analysis",product);object.__setattr__(self,"index_mode",mode)

    @classmethod
    def from_mapping(cls,value: Mapping[str,Any] | None) -> "PadiyarSwitchOptions":
        if value is None:return cls()
        aliases={"padiyar_index_mode":"index_mode","padiyar_sg_trip_time":"sg_trip_time",
                 "padiyar_sg_reclose_time":"sg_reclose_time"}
        ignored={"plot_results","plot_visible","verbose"}
        resolved={aliases.get(k,k):v for k,v in value.items() if k not in ignored}
        unknown=sorted(set(resolved)-set(cls.__dataclass_fields__))
        if unknown:raise PowerFlowError("unknown_ibr_options",f"Unknown Padiyar-switch options: {', '.join(unknown)}")
        return cls(**resolved)


@dataclass(frozen=True, slots=True)
class PadiyarSwitchResult(Ieee14SwitchResult):
    pass


class _PadiyarSg:
    def __init__(self,dae: PadiyarDae,k: int,droop: float=.05) -> None:
        m,u=dae.machine,dae.units;self.dae=dae;self.k=k;self.r=droop
        self.ra=m.ra[k];self.xd=m.xd[k];self.xdp=m.xdp[k];self.xq=m.xq[k];self.xqp=m.xqp[k]
        self.tpd0=m.tpd0[k];self.tpq0=m.tpq0[k];self.ka=m.ka[k];self.ta=m.ta[k]
        self.h=u.inertia[k];self.d=u.damping[k];self.omega_b=m.synchronous_speed
        self.pm=dae.mechanical_power[k];self.q0=dae.pf.q_generation[u.bus_indices[k]]
        self.efd0=dae.field_voltage0[k];self.vref=dae.voltage_reference[k]
        ns=dae.states_per_machine;self.x0=dae.x0[ns*k:ns*(k+1)].copy()

    def stator(self,x: np.ndarray,voltage: complex) -> tuple[float,float,float,float]:
        vd,vq=_to_dq(voltage,x[0]);rd,rq=vd-x[3],vq-x[2]
        den=self.ra**2+self.xdp*self.xqp
        return ((-self.ra*rd-self.xqp*rq)/den,
                (self.xdp*rd-self.ra*rq)/den,vd,vq)

    def current(self,x: np.ndarray,voltage: complex) -> complex:
        i_d,i_q,_,_=self.stator(x,voltage);return _from_dq(i_d,i_q,x[0])

    def rhs(self,x: np.ndarray,voltage: complex) -> np.ndarray:
        i_d,i_q,vd,vq=self.stator(x,voltage);omega,eqp,edp=x[1:4]
        efd=x[4] if x.size==5 else self.efd0
        torque=vd*i_d+vq*i_q+self.ra*(i_d*i_d+i_q*i_q)
        result=[self.omega_b*(omega-1),
                (self.pm-(omega-1)/self.r-torque-self.d*(omega-1))/(2*self.h),
                (efd-eqp-(self.xd-self.xdp)*i_d)/self.tpd0,
                (-edp+(self.xq-self.xqp)*i_q)/self.tpq0]
        if x.size==5:result.append((self.ka*(self.vref-abs(voltage))-efd)/self.ta)
        return np.asarray(result)

    def reinitialize(self,voltage: complex) -> np.ndarray:
        current=np.conj(complex(self.pm,self.q0)/voltage)
        delta=np.angle(voltage+complex(self.ra,self.xq)*current)
        for _ in range(60):
            i_d,i_q=_to_dq(current,delta);v_d,_=_to_dq(voltage,delta)
            residual=v_d+self.ra*i_d-self.xq*i_q
            if abs(residual)<1e-12:break
            h=1e-7;idp,iqp=_to_dq(current,delta+h);vdp,_=_to_dq(voltage,delta+h)
            delta-=residual/((vdp+self.ra*idp-self.xq*iqp-residual)/h)
        i_d,i_q=_to_dq(current,delta);_,v_q=_to_dq(voltage,delta)
        edp=(self.xq-self.xqp)*i_q;eqp=v_q+self.ra*i_q+self.xdp*i_d
        values=[delta,1.0,eqp,edp]
        if self.x0.size==5:values.append(eqp+(self.xd-self.xdp)*i_d)
        return np.asarray(values)


def _build_system(opt: PadiyarSwitchOptions) -> _System:
    dae=build_padiyar_dae(load_case("padiyar_two_area"),PadiyarOptions(excitation="avr"))
    machine_index=int(np.flatnonzero(dae.units.bus_ids==11)[0]);sg=_PadiyarSg(dae,machine_index)
    bus_ids=np.asarray(dae.pf.external_bus_ids);positions=np.asarray([
        int(np.flatnonzero(bus_ids==bus)[0]) for bus in (1,2,12)
    ])
    voltage=dae.y0[0::2]+1j*dae.y0[1::2];zbus=np.linalg.inv(dae.y_network)
    devices=[];states=[sg.x0];scr=np.zeros(3)
    for j,position in enumerate(positions):
        p,q=dae.pf.p_generation[position],dae.pf.q_generation[position]
        rating=abs(complex(p,q));device=_ScaledSupervisor(
            voltage[position],p,q,rating,opt.index_mode,opt.agsi_up,opt.agsi_down,
        )
        devices.append(device);states.append(device.x0)
        scr[j]=abs(voltage[position])**2/(abs(zbus[position,position])*rating)
    return _System(bus_ids,dae.y_network.copy(),dae.y0.copy(),sg,devices,
                   np.concatenate(states),int(dae.units.bus_indices[machine_index]),positions,scr,dae.pf)


def solve_padiyar_switch(case_id: str,options: PadiyarSwitchOptions | Mapping[str,Any] | None=None) -> PadiyarSwitchResult:
    if case_id.strip().lower()!="padiyar_switch":
        raise PowerFlowError("ibr_case_not_implemented",f"Padiyar switching case {case_id!r} is not implemented.")
    opt=options if isinstance(options,PadiyarSwitchOptions) else PadiyarSwitchOptions.from_mapping(options)
    system=_build_system(opt);initial_residual=_equilibrium_residual(system)
    if initial_residual>1e-7:
        raise PowerFlowError("padiyar_switch_equilibrium",f"Composite equilibrium residual is {initial_residual:.3e}.")
    matrix,eigenvalues=_linearize(system,opt.fd_eps)
    time=state=bus_voltage=frequency=index=mode=p_ibr=q_ibr=v_min=sg_online=residual=None
    events=np.empty((0,4));final_modes=tuple(device.mode for device in system.devices)
    converged=True
    if opt.ibr_analysis in {"ts","full"}:
        (time,state,bus_voltage,frequency,index,mode,p_ibr,q_ibr,v_min,sg_online,
         events,residual,converged)=_simulate(system,opt)
        final_modes=tuple(device.mode for device in system.devices)
    return PadiyarSwitchResult(
        "padiyar_switch","Padiyar two-area: one SG and three switchable IBRs",opt.ibr_analysis,
        converged,system.bus_ids,system.pf.bus_voltage,system.pf.bus_angle_deg,matrix,eigenvalues,
        time,state,bus_voltage,frequency,index,mode,p_ibr,q_ibr,v_min,sg_online,events,
        final_modes,residual,MappingProxyType({
            "classification":"ASSUMED_DIAGNOSTIC_PADIYAR_1SG_3GFL_SWITCH",
            "schema_version":"padiyar_switch/1.0","device_count":4,
            "method_source":"project-owned composite DAE and implicit trapezoidal Newton",
            "initial_equilibrium_residual":initial_residual,"sg_bus":11,
            "ibr_buses":[1,2,12],"fallback_used":False,
        }),
    )
