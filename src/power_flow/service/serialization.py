"""Translate numerical result contracts into the web application's JSON ABI."""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np

from power_flow.contracts import BusType, PowerFlowResult


def _finite(value: float, fallback: float = 0.0) -> float:
    return float(value) if np.isfinite(value) else fallback


def _mode_rows(eigenvalues: np.ndarray, names: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    rows=[]
    for index,value in enumerate(np.asarray(eigenvalues,dtype=complex)):
        magnitude=abs(value);real=float(value.real);imag=float(value.imag)
        rows.append({
            "index":index+1,"real":real,"imag":imag,
            "frequencyHz":abs(imag)/(2*np.pi),
            "dampingRatio":-real/magnitude if magnitude else 0.0,
            "timeConstantS":(-1/real if real<0 else None),
            "classification":"unstable" if real>1e-7 else ("stable" if real<-1e-7 else "marginal"),
            "dominantState":names[index] if index<len(names) else "not available",
            "participation":0.0,
        })
    return rows


def _pf_result(result: PowerFlowResult) -> dict[str,Any]:
    base=100.0;buses=[]
    labels={int(BusType.REF):"REF",int(BusType.PV):"PV",int(BusType.PQ):"PQ"}
    limited={event.bus_id:event.limit_type for event in result.q_limit_events}
    for k,bus_id in enumerate(result.external_bus_ids):
        buses.append({
            "busId":int(bus_id),"name":f"Bus {int(bus_id)}","type":labels[int(result.bus_type[k])],
            "vMagPu":float(result.bus_voltage[k]),"vAngleDeg":float(result.bus_angle_deg[k]),
            "pGenMw":base*float(result.p_generation[k]),"qGenMvar":base*float(result.q_generation[k]),
            "pLoadMw":base*float(result.p_load[k]),"qLoadMvar":base*float(result.q_load[k]),
            "qLimitHit":limited.get(int(bus_id),"none"),
        })
    branches=[]
    for k,(start,end) in enumerate(result.line_endpoints):
        branches.append({
            "branchId":k+1,"fromBus":int(start),"toBus":int(end),
            "pFromMw":base*float(result.line_flow_p[k]),"qFromMvar":base*float(result.line_flow_q[k]),
            "pToMw":base*float(result.line_loss_p[k]-result.line_flow_p[k]),
            "qToMvar":base*float(result.line_loss_q[k]-result.line_flow_q[k]),
            "pLossMw":base*float(result.line_loss_p[k]),"qLossMvar":base*float(result.line_loss_q[k]),
            "loadingPct":0.0,
        })
    return {
        "kind":"pf","systemName":result.system_name,"method":result.method,
        "converged":result.converged,"reason":result.reason,"finiteStatus":result.finite_status,
        "iterations":result.iterations,"maxMismatch":result.max_mismatch,
        "mismatchHistory":result.mismatch_history.tolist(),
        "pLossTotalMw":base*result.p_loss_total,"qLossTotalMvar":base*result.q_loss_total,
        "pTotalGenMw":base*result.p_total_gen,"qTotalGenMvar":base*result.q_total_gen,
        "pTotalLoadMw":base*result.p_total_load,"qTotalLoadMvar":base*result.q_total_load,
        "buses":buses,"branches":branches,
        "qLimitEvents":[{
            "round":e.round,"busId":e.bus_id,"fromType":e.from_type,"toType":e.to_type,
            "qBeforeMvar":base*e.q_generation_before,"qFixedMvar":base*e.q_fixed,"limitType":e.limit_type,
        } for e in result.q_limit_events],
    }


def _sssa_result(result: Any) -> dict[str,Any]:
    eigenvalues=np.asarray(result.eigenvalues);rows=_mode_rows(eigenvalues,tuple(getattr(result,"state_names",())))
    damping=[row["dampingRatio"] for row in rows if row["imag"]>1e-7]
    critical=int(np.argmin(damping))+1 if damping else 0
    return {
        "kind":"sssa","systemName":result.system_name,
        "model":str(getattr(result,"model",getattr(result,"case_id","model"))),
        "stable":not np.any(eigenvalues.real>1e-7),
        "classification":str(getattr(result,"stability_status","diagnostic")),
        "stateCount":int(eigenvalues.size),"modes":rows,
        "minDampingRatio":min(damping) if damping else 0.0,
        "criticalModeIndex":critical,"coiReduction":False,
    }


def _switching_result(result: Any) -> dict[str,Any]:
    time=np.asarray(result.time);series=[];signals=[]
    for k,bus in enumerate(result.bus_ids):
        sid=f"bus.{int(bus)}.v"
        values=np.abs(np.asarray(result.bus_voltage)[:,k]).tolist()
        series.append({"signalId":sid,"label":f"Bus {int(bus)} voltage","unit":"pu","panel":"voltage","values":values})
        signals.append({"id":sid,"label":f"Bus {int(bus)} voltage","group":"Buses","unit":"pu","panel":"voltage"})
    ibr_buses=list(result.metadata.get("ibr_buses",[]));transactions=[];events=[]
    for j,bus in enumerate(ibr_buses):
        for suffix,label,unit,panel,data in (
            ("frequency","Frequency","Hz","frequency",result.frequency_ibr[:,j]),
            ("p","Active power","pu","power",result.p_ibr[:,j]),
            ("q","Reactive power","pu","power",result.q_ibr[:,j]),
            ("agsi","AGSI","","agsi",result.index[:,j]),
            ("mode","Mode","","mode",result.mode[:,j]),
        ):
            sid=f"ibr.{int(bus)}.{suffix}";series.append({"signalId":sid,"label":f"IBR {int(bus)} {label}","unit":unit,"panel":panel,"values":np.asarray(data).tolist()})
            signals.append({"id":sid,"label":f"IBR {int(bus)} {label}","group":"IBRs","unit":unit,"panel":panel,"device":f"IBR {int(bus)}"})
    if result.newton_residual is not None:
        values=np.r_[0.0,np.asarray(result.newton_residual)].tolist();sid="solver.residual"
        series.append({"signalId":sid,"label":"Newton residual","unit":"pu","panel":"residual","values":values})
        signals.append({"id":sid,"label":"Newton residual","group":"Solver","unit":"pu","panel":"residual"})
    previous={j:"GFL" for j in range(1,len(ibr_buses)+1)}
    for k,row in enumerate(np.asarray(result.switch_events)):
        t,device_index,agsi,forming=map(float,row);j=int(device_index);target="GFM" if forming else "GFL"
        source=previous[j];previous[j]=target;bus=int(ibr_buses[j-1])
        transactions.append({"id":f"switch-{k+1}","t":t,"device":f"IBR {bus}","from":source,"to":target,
                             "trigger":"reference handback" if np.isnan(agsi) else "AGSI++ threshold",
                             "agsi":_finite(agsi),"vPccPu":0.0,"accepted":True,"note":""})
        events.append({"id":f"event-{k+1}","kind":"mode_switch","t":t,"label":f"IBR {bus}: {source} → {target}",
                       "detail":"Reference handback" if np.isnan(agsi) else f"AGSI={agsi:.6g}",
                       "device":f"IBR {bus}","severity":"warning" if target=="GFM" else "info"})
    return {
        "kind":"switching","systemName":result.system_name,"model":"AGSI++ multi-bus switching",
        "integrator":"implicit trapezoidal","dt":float(time[1]-time[0]) if time.size>1 else 0.0,
        "tEnd":float(time[-1]),"converged":bool(result.converged),"steps":int(time.size-1),
        "time":time.tolist(),"series":series,"events":events,"maxAngleDeviationDeg":0.0,
        "maxFrequencyDeviationHz":float(np.max(np.abs(np.asarray(result.frequency_ibr)-60))),
        "transactions":transactions,
        "devices":[{"id":"sg","label":f"SG bus {result.metadata['sg_bus']}","type":"SG","bus":result.metadata["sg_bus"]}]+[
            {"id":f"ibr-{bus}","label":f"IBR bus {bus}","type":"GFL","bus":bus} for bus in ibr_buses],
        "_signals":signals,
    }


def serialize_result(result: Any,config: Mapping[str,Any]) -> tuple[dict[str,Any],list[dict[str,Any]]]:
    if isinstance(result,PowerFlowResult):payload=_pf_result(result);signals=[]
    elif getattr(result,"time",None) is not None and hasattr(result,"switch_events"):
        payload=_switching_result(result);signals=payload.pop("_signals")
    elif getattr(result,"eigenvalues",None) is not None:
        payload=_sssa_result(result);signals=[]
    else:
        summary=result.summary() if hasattr(result,"summary") else {"value":str(result)}
        payload={"kind":"tds","systemName":summary.get("system_name","Power-system run"),
                 "model":summary.get("model",config.get("analysis","analysis")),"integrator":"trapezoidal",
                 "dt":0.0,"tEnd":0.0,"converged":True,"steps":summary.get("steps",0),"time":[],"series":[],
                 "events":[],"maxAngleDeviationDeg":0.0,"maxFrequencyDeviationHz":0.0};signals=[]
    return payload,signals


def series_chunks(payload: Mapping[str,Any],chunk_size: int=256) -> list[dict[str,Any]]:
    if payload.get("kind") not in {"tds","switching"}:return []
    time=list(payload.get("time",[]));series=list(payload.get("series",[]));chunks=[]
    for start in range(0,len(time),chunk_size):
        stop=min(len(time),start+chunk_size)
        chunks.append({"t":time[start:stop],"values":{item["signalId"]:item["values"][start:stop] for item in series}})
    return chunks
