import threading
import time

import pytest

from power_flow.service.jobs import InMemoryRunService


def _wait(service,run_id,timeout=10):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        detail=service.detail(run_id)
        if detail["status"] in {"converged","failed","cancelled"}:return detail
        time.sleep(.01)
    raise AssertionError("run did not finish")


def test_run_service_executes_pf_and_serializes_frontend_contract():
    service=InMemoryRunService(max_workers=1)
    try:
        detail=service.submit({"label":"IEEE14 PF","config":{"analysis":"pf","case":"ieee14","options":{
            "pf_method":"newton_raphson","tolerance":1e-10,"max_iter":50,"enforce_q_limits":False,
            "acceleration":1.4,"q_limit_tolerance":1e-6,"max_q_limit_switches":20,
        }}})
        done=_wait(service,detail["id"]);payload=service.result(detail["id"])
        assert done["status"]=="converged"
        assert payload["result"]["kind"]=="pf"
        assert len(payload["result"]["buses"])==14
        assert len(payload["result"]["branches"])==20
        assert payload["result"]["maxMismatch"]<1e-9
        snapshot=service.snapshot(detail["id"])
        assert snapshot["type"]=="snapshot" and snapshot["logs"]
        assert service.stats()["converged"]==1
    finally:service.close()


def test_run_service_switching_result_publishes_signal_chunks():
    service=InMemoryRunService(max_workers=1)
    try:
        detail=service.submit({"config":{"analysis":"ibr","case":"ieee14_switch","options":{
            "ibr_analysis":"ts","t_end":1.002,"dt":.002,"fault_on":0,"fault_clear":0,
            "fault_reactance":.1,"step_on":0,"step_dv":-.1,"step_dphase_deg":20,
            "sssa_load_percentages":[],
        }}})
        done=_wait(service,detail["id"]);payload=service.result(detail["id"])
        assert done["status"]=="converged"
        assert payload["result"]["kind"]=="switching"
        assert payload["result"]["transactions"]
        assert done["signals"]
        snapshot=service.snapshot(detail["id"])
        assert snapshot["chunks"]
        assert any(event["kind"]=="mode_switch" for event in done["events"])
        assert any(log["source"]=="switching" for log in snapshot["logs"])
    finally:service.close()


def test_queued_run_can_be_cancelled(monkeypatch):
    gate=threading.Event()
    class Result:
        converged=True
        def summary(self):return {"system_name":"blocked"}
    def blocked(*_args,**_kwargs):gate.wait(2);return Result()
    monkeypatch.setattr("power_flow.service.jobs.solve_case",blocked)
    service=InMemoryRunService(max_workers=1)
    try:
        request={"config":{"analysis":"pf","case":"ieee5","options":{}}}
        first=service.submit(request);second=service.submit(request)
        service.cancel(second["id"]);gate.set()
        assert _wait(service,second["id"])["status"]=="cancelled"
        events,_=service.events_after(second["id"],0)
        assert sum(event["type"]=="done" for _,event in events)==1
    finally:gate.set();service.close()


def test_running_switch_simulation_observes_cancellation():
    service=InMemoryRunService(max_workers=1)
    try:
        detail=service.submit({"config":{"analysis":"ibr","case":"padiyar_switch","options":{
            "ibr_analysis":"ts","t_end":8.0,"dt":.002,"fault_on":0,"fault_clear":0,
            "fault_reactance":.1,"step_on":0,"step_dv":-.1,"step_dphase_deg":20,
            "sssa_load_percentages":[],
        }}})
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            if service.snapshot(detail["id"])["chunks"]:break
            time.sleep(.01)
        assert service.snapshot(detail["id"])["chunks"]
        service.cancel(detail["id"])
        assert _wait(service,detail["id"],timeout=5)["status"]=="cancelled"
    finally:service.close()
