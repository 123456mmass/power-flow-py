"""Thread-safe in-process run service with resumable event history."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass,field
from datetime import datetime,timezone
import platform
import threading
import time
from typing import Any,Mapping
from uuid import uuid4

import numpy as np
import scipy

from power_flow.api import solve_case
from power_flow.cases import catalog_ids,load_case
from power_flow.contracts import PowerFlowError
from power_flow.service.serialization import serialize_result,series_chunks


TERMINAL={"converged","failed","cancelled"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")


def _progress(stage: str,fraction: float=0.0,elapsed: int=0) -> dict[str,Any]:
    return {"fraction":fraction,"simTime":None,"simEnd":None,"step":0,"totalSteps":None,
            "elapsedMs":elapsed,"etaMs":None,"stage":stage}


@dataclass(slots=True)
class _Run:
    id: str;request: dict[str,Any];created_at: str;label: str
    status: str="queued";started_at: str="";finished_at: str|None=None
    progress: dict[str,Any]=field(default_factory=lambda:_progress("Queued"))
    reason: str|None=None;error_code: str|None=None;finite_status: str|None=None
    result: dict[str,Any]|None=None;warnings: list[str]=field(default_factory=list)
    signals: list[dict[str,Any]]=field(default_factory=list);sim_events: list[dict[str,Any]]=field(default_factory=list)
    logs: list[dict[str,Any]]=field(default_factory=list);chunks: list[dict[str,Any]]=field(default_factory=list)
    events: list[tuple[int,dict[str,Any]]]=field(default_factory=list);event_seq: int=0
    cancel_requested: bool=False;iterations: int|None=None;max_mismatch: float|None=None
    condition: threading.Condition=field(default_factory=threading.Condition)


class InMemoryRunService:
    def __init__(self,max_workers: int=2) -> None:
        self._runs: dict[str,_Run]={};self._lock=threading.RLock()
        self._executor=ThreadPoolExecutor(max_workers=max_workers,thread_name_prefix="power-flow-run")
        self._started=time.monotonic();self._presets: list[dict[str,Any]]=[];self._audit: list[dict[str,Any]]=[]

    def close(self) -> None:
        self._executor.shutdown(wait=True,cancel_futures=True)

    def _emit(self,run: _Run,event: dict[str,Any]) -> None:
        with run.condition:
            run.event_seq+=1;run.events.append((run.event_seq,deepcopy(event)));run.condition.notify_all()

    def _log(self,run: _Run,level: str,message: str,source: str="solver") -> None:
        record={"seq":run.event_seq+1,"at":_now(),"level":level,"source":source,"message":message}
        run.logs.append(record);self._emit(run,{"type":"log","runId":run.id,"records":[record]})

    def _set_status(self,run: _Run,status: str) -> None:
        run.status=status;self._emit(run,{"type":"status","runId":run.id,"status":status,"at":_now()})

    @staticmethod
    def _solver_options(config: Mapping[str,Any]) -> dict[str,Any]:
        analysis=str(config["analysis"]);case=str(config["case"]);raw=dict(config.get("options",{}))
        if analysis=="ibr":
            if "fault_reactance" in raw:raw["fault_impedance"]=1j*float(raw.pop("fault_reactance"))
            if case in {"ieee14_switch","ieee14_1sg_4ibr","padiyar_switch","two_ibr_switch"}:
                allowed={"ibr_analysis","t_end","dt"};raw={k:v for k,v in raw.items() if k in allowed}
            elif raw.get("ibr_analysis")!="sssa_load_sweep":
                raw.pop("sssa_load_percentages",None)
        return raw

    @staticmethod
    def _switch_signals(case_id: str) -> list[dict[str,Any]]:
        buses,ibr_buses=(([1,2,3,4,5,6,7,8,9,10,11,12,13,14],[2,3,6,8]) if case_id in {"ieee14_switch","ieee14_1sg_4ibr"}
                         else ([1,2,3,4,5,6,7,8,11,12],[1,2,12]))
        rows=[{"id":f"bus.{bus}.v","label":f"Bus {bus} voltage","group":"Buses","unit":"pu","panel":"voltage"} for bus in buses]
        for bus in ibr_buses:
            for suffix,label,unit,panel in (("frequency","Frequency","Hz","frequency"),("p","Active power","pu","power"),
                    ("q","Reactive power","pu","power"),("agsi","AGSI","","agsi"),("mode","Mode","","mode")):
                rows.append({"id":f"ibr.{bus}.{suffix}","label":f"IBR {bus} {label}","group":"IBRs","unit":unit,"panel":panel,"device":f"IBR {bus}"})
        rows.append({"id":"solver.residual","label":"Newton residual","group":"Solver","unit":"pu","panel":"residual"})
        return rows

    def _live_callback(self,run: _Run) -> Any:
        def callback(message: Mapping[str,Any]) -> None:
            if message.get("type")=="samples":
                chunk={"seq":run.event_seq+1,"t":list(message["t"]),"values":deepcopy(message["values"])}
                run.chunks.append(chunk);self._emit(run,{"type":"samples","runId":run.id,"chunk":chunk})
                step=int(message.get("step",0));total=int(message.get("totalSteps",0));sim=float(chunk["t"][-1])
                sim_end=float(run.request["config"].get("options",{}).get("t_end",sim))
                run.progress={"fraction":step/total if total else 0.0,"simTime":sim,"simEnd":sim_end,
                              "step":step,"totalSteps":total or None,"elapsedMs":0,"etaMs":None,"stage":"Time-domain integration"}
                self._emit(run,{"type":"progress","runId":run.id,"progress":deepcopy(run.progress)})
            elif message.get("type")=="grid_event":
                kind=str(message["kind"])
                event={"id":f"live-grid-{len(run.sim_events)+1}","kind":kind,"t":float(message["t"]),
                       "label":str(message["label"]),"detail":str(message["detail"]),"device":"SG 1",
                       "severity":"fault" if kind=="trip" else "info"}
                run.sim_events.append(event);self._emit(run,{"type":"event","runId":run.id,"event":event})
                self._log(run,"warn" if kind=="trip" else "info",event["label"]+" — "+event["detail"],"switching")
            elif message.get("type")=="mode_switch":
                event={"id":f"live-switch-{len(run.sim_events)+1}","kind":"mode_switch","t":float(message["t"]),
                       "label":f"IBR {message['bus']}: {message['from']} → {message['to']}",
                       "detail":message.get("trigger","mode switch")+("" if message.get("agsi") is None else f"; AGSI={float(message['agsi']):.6g}"),
                       "device":f"IBR {message['bus']}","severity":"warning" if message["to"]=="GFM" else "info"}
                run.sim_events.append(event);self._emit(run,{"type":"event","runId":run.id,"event":event})
                self._log(run,"warn" if message["to"]=="GFM" else "info",event["label"]+" — "+event["detail"],"switching")
        return callback

    def submit(self,request: Mapping[str,Any],user: str="demo.engineer") -> dict[str,Any]:
        body=deepcopy(dict(request));config=body.get("config")
        if not isinstance(config,dict) or not {"analysis","case","options"}.issubset(config):
            raise PowerFlowError("run_request","config.analysis, config.case, and config.options are required.")
        run_id=f"run-{uuid4().hex[:12]}";label=str(body.get("label") or f"{config['case']} {config['analysis'].upper()}")
        run=_Run(run_id,body,_now(),label,started_at=_now())
        with self._lock:self._runs[run_id]=run
        self._log(run,"info","Run accepted and queued.","queue");self._audit_add(user,"run.submit",run_id,label)
        self._executor.submit(self._execute,run)
        return self.detail(run_id)

    def _execute(self,run: _Run) -> None:
        started=time.monotonic();config=run.request["config"]
        if run.cancel_requested:self._finish_cancelled(run);return
        self._set_status(run,"initializing");run.progress=_progress("Validating configuration",.02)
        self._emit(run,{"type":"progress","runId":run.id,"progress":deepcopy(run.progress)})
        self._log(run,"info",f"Initializing {config['analysis']} analysis for {config['case']}.")
        if config["analysis"]=="ibr" and config["case"] in {"ieee14_switch","ieee14_1sg_4ibr","padiyar_switch"}:
            run.signals=self._switch_signals(str(config["case"]))
        if run.cancel_requested:self._finish_cancelled(run);return
        self._set_status(run,"running");run.progress=_progress("Numerical solve",.08)
        self._emit(run,{"type":"progress","runId":run.id,"progress":deepcopy(run.progress)})
        try:
            options=self._solver_options(config)
            if config["analysis"]=="ibr" and config["case"] in {"ieee14_switch","ieee14_1sg_4ibr","padiyar_switch"}:
                options.update({"stream_callback":self._live_callback(run),"cancel_check":lambda:run.cancel_requested,"stream_stride":10})
            result=solve_case(str(config["analysis"]),str(config["case"]),options)
            if run.cancel_requested:self._finish_cancelled(run);return
            live_grid_events=[event for event in run.sim_events if event.get("kind") in {"trip","reclose"}]
            payload,signals=serialize_result(result,config);run.result=payload;run.signals=signals
            combined_events=list(payload.get("events",[]))+live_grid_events
            combined_events.sort(key=lambda event:float(event.get("t",0.0)))
            payload["events"]=combined_events;run.sim_events=combined_events
            summary=result.summary() if hasattr(result,"summary") else {}
            run.iterations=summary.get("iterations");run.max_mismatch=summary.get("max_mismatch")
            chunks=[] if run.chunks else series_chunks(payload)
            for chunk in chunks:
                chunk["seq"]=run.event_seq+1;run.chunks.append(chunk)
                self._emit(run,{"type":"samples","runId":run.id,"chunk":chunk})
            run.progress=_progress("Complete",1.0,int((time.monotonic()-started)*1000))
            if payload.get("time"):
                run.progress.update({"simTime":payload["time"][-1],"simEnd":payload["time"][-1],
                                     "step":len(payload["time"])-1,"totalSteps":len(payload["time"])-1})
            self._emit(run,{"type":"progress","runId":run.id,"progress":deepcopy(run.progress)})
            converged=bool(getattr(result,"converged",True));run.reason="converged" if converged else "not_converged"
            self._set_status(run,"converged" if converged else "failed")
            self._log(run,"info" if converged else "warn",f"Run finished: {run.reason}.")
        except PowerFlowError as error:
            if error.code=="run_cancelled" or run.cancel_requested:self._finish_cancelled(run)
            else:
                run.error_code=error.code;run.reason=str(error);self._set_status(run,"failed");self._log(run,"error",str(error))
        except Exception as error:  # fail closed at the service boundary
            run.error_code="internal_solver_error";run.reason=str(error);self._set_status(run,"failed")
            self._log(run,"error",f"Unhandled solver failure: {error}")
        finally:
            run.finished_at=run.finished_at or _now()
            if not run.events or run.events[-1][1].get("type")!="done":
                self._emit(run,{"type":"done","runId":run.id,"status":run.status})

    def _finish_cancelled(self,run: _Run) -> None:
        self._set_status(run,"cancelled");run.reason="cancelled_by_user";run.finished_at=_now()
        self._log(run,"warn","Run cancelled by user.","queue");self._emit(run,{"type":"done","runId":run.id,"status":"cancelled"})

    def _get(self,run_id: str) -> _Run:
        with self._lock:
            try:return self._runs[run_id]
            except KeyError as error:raise PowerFlowError("run_not_found",f"Run {run_id!r} was not found.") from error

    def detail(self,run_id: str) -> dict[str,Any]:
        run=self._get(run_id);config=run.request["config"]
        duration=None
        if run.finished_at:
            # Progress elapsed is authoritative and avoids reparsing ISO text.
            duration=int(run.progress.get("elapsedMs",0))
        return {"id":run.id,"label":run.label,"analysis":config["analysis"],"caseId":config["case"],
                "caseName":str(config["case"]).replace("_"," ").title(),"solver":config.get("options",{}).get("pf_method","project-owned"),
                "model":config.get("options",{}).get("model"),"status":run.status,"startedAt":run.started_at,
                "finishedAt":run.finished_at,"durationMs":duration,"converged":True if run.status=="converged" else (False if run.status in TERMINAL else None),
                "iterations":run.iterations,"maxMismatch":run.max_mismatch,"worker":"local-1","user":"demo.engineer",
                "warnings":len(run.warnings),"config":deepcopy(config),"progress":deepcopy(run.progress),"reason":run.reason,
                "errorCode":run.error_code,"finiteStatus":run.finite_status,"signals":deepcopy(run.signals),
                "events":deepcopy(run.sim_events),"environment":{"solverVersion":"0.1.0","python":platform.python_version(),
                "numpy":np.__version__,"scipy":scipy.__version__,"host":platform.node() or "localhost","seed":0}}

    def list_runs(self) -> list[dict[str,Any]]:
        with self._lock:ids=list(reversed(self._runs))
        return [self.detail(item) for item in ids]

    def cancel(self,run_id: str,user: str="demo.engineer") -> dict[str,Any]:
        run=self._get(run_id)
        if run.status not in TERMINAL:
            run.cancel_requested=True;self._log(run,"warn","Cancellation requested.","queue")
            self._audit_add(user,"run.cancel",run_id,"Cancellation requested")
        return self.detail(run_id)

    def delete(self,run_id: str,user: str="demo.engineer") -> None:
        run=self._get(run_id)
        if run.status not in TERMINAL:raise PowerFlowError("run_active","A running job must be cancelled before deletion.")
        with self._lock:del self._runs[run_id]
        self._audit_add(user,"run.delete",run_id,run.label)

    def result(self,run_id: str) -> dict[str,Any]:
        run=self._get(run_id)
        if run.result is None:raise PowerFlowError("result_not_ready","Run result is not available.")
        return {"run":self.detail(run_id),"result":deepcopy(run.result),"warnings":list(run.warnings),
                "inputSnapshot":deepcopy(run.request["config"])}

    def snapshot(self,run_id: str,from_seq: int=0) -> dict[str,Any]:
        run=self._get(run_id)
        return {"type":"snapshot","run":self.detail(run_id),
                "logs":[deepcopy(x) for x in run.logs if x["seq"]>from_seq],
                "chunks":[deepcopy(x) for x in run.chunks if x["seq"]>from_seq]}

    def events_after(self,run_id: str,cursor: int) -> tuple[list[tuple[int,dict[str,Any]]],bool]:
        run=self._get(run_id)
        with run.condition:
            events=[(seq,deepcopy(event)) for seq,event in run.events if seq>cursor]
            return events,run.status in TERMINAL

    def event_cursor(self,run_id: str) -> int:return self._get(run_id).event_seq

    def wait_for_events(self,run_id: str,cursor: int,timeout: float=.5) -> None:
        run=self._get(run_id)
        with run.condition:
            if not any(seq>cursor for seq,_ in run.events) and run.status not in TERMINAL:run.condition.wait(timeout)

    def cases(self) -> list[dict[str,Any]]:
        rows=[]
        for case_id in catalog_ids():
            case=load_case(case_id);rows.append({"id":case_id,"name":case.system_name,"buses":case.bus_data.shape[0],
                "branches":case.line_data.shape[0],"generators":int(np.count_nonzero(case.bus_data[:,1]<3)),
                "ibrDevices":0,"radial":case.line_data.shape[0]==case.bus_data.shape[0]-1,
                "analyses":["pf","sssa","ts"],"provenance":str(case.reference.get("source","project catalogue")),"readiness":"production"})
        rows.extend([
            {"id":"ieee14_switch","name":"IEEE14 one SG + four IBR switching","buses":14,"branches":20,"generators":1,"ibrDevices":4,"radial":False,"analyses":["ibr"],"provenance":"project-owned MATLAB-parity route","readiness":"diagnostic"},
            {"id":"padiyar_switch","name":"Padiyar one SG + three IBR switching","buses":10,"branches":0,"generators":1,"ibrDevices":3,"radial":False,"analyses":["ibr"],"provenance":"project-owned MATLAB-parity route","readiness":"diagnostic"},
        ])
        return rows

    def health(self) -> dict[str,Any]:
        active=[r for r in self._runs.values() if r.status not in TERMINAL]
        return {"status":"ok","solverVersion":"0.1.0","queueDepth":len(active),"workers":[{"id":"local-1","status":"busy" if active else "idle","queueDepth":len(active),"cpuPct":0.0,"memPct":0.0,"currentRunId":active[0].id if active else None,"lastHeartbeat":_now()}],"uptimeS":int(time.monotonic()-self._started),"checkedAt":_now()}

    def stats(self) -> dict[str,Any]:
        runs=list(self._runs.values());durations=[r.progress.get("elapsedMs",0) for r in runs if r.finished_at]
        return {"totalRuns":len(runs),"converged":sum(r.status=="converged" for r in runs),"failed":sum(r.status=="failed" for r in runs),
                "running":sum(r.status not in TERMINAL for r in runs),"cancelled":sum(r.status=="cancelled" for r in runs),
                "avgDurationMs":sum(durations)/len(durations) if durations else 0,"trend":{"t":[],"voltagePu":[],"frequencyHz":[]}}

    def _audit_add(self,user: str,action: str,run_id: str|None,detail: str) -> None:
        self._audit.insert(0,{"id":f"audit-{uuid4().hex[:10]}","at":_now(),"user":user,"action":action,"runId":run_id,"detail":detail,"ip":"local"})

    def audit(self) -> list[dict[str,Any]]:return deepcopy(self._audit)
    def presets(self) -> list[dict[str,Any]]:return deepcopy(self._presets)
    def save_preset(self,value: Mapping[str,Any],user: str="demo.engineer") -> dict[str,Any]:
        preset={**deepcopy(dict(value)),"id":f"preset-{uuid4().hex[:10]}","createdAt":_now(),"owner":user}
        self._presets.append(preset);self._audit_add(user,"preset.save",None,str(preset.get("name","Preset")));return deepcopy(preset)
    def delete_preset(self,preset_id: str) -> None:
        before=len(self._presets);self._presets=[p for p in self._presets if p["id"]!=preset_id]
        if len(self._presets)==before:raise PowerFlowError("preset_not_found",f"Preset {preset_id!r} was not found.")
