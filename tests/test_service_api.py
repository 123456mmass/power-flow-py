import time
import json

from fastapi.testclient import TestClient

from power_flow.service.app import create_app
from power_flow.service.jobs import InMemoryRunService


def test_rest_api_health_cases_run_result_and_audit():
    service=InMemoryRunService(max_workers=1);app=create_app(service)
    try:
        with TestClient(app) as client:
            assert client.get("/api/health").json()["status"]=="ok"
            assert any(case["id"]=="padiyar_switch" for case in client.get("/api/cases").json())
            response=client.post("/api/runs",json={"config":{"analysis":"pf","case":"ieee5","options":{
                "pf_method":"newton_raphson","tolerance":1e-10,"max_iter":50,"enforce_q_limits":False,
                "acceleration":1.4,"q_limit_tolerance":1e-6,"max_q_limit_switches":20,
            }}})
            assert response.status_code==202;run_id=response.json()["id"]
            for _ in range(200):
                run=client.get(f"/api/runs/{run_id}").json()
                if run["status"] in {"converged","failed"}:break
                time.sleep(.01)
            assert run["status"]=="converged"
            result=client.get(f"/api/runs/{run_id}/result")
            assert result.status_code==200 and result.json()["result"]["kind"]=="pf"
            assert client.get("/api/runs").json()["total"]==1
            assert client.get("/api/audit").json()["items"][0]["action"]=="run.submit"
    finally:service.close()


def test_rest_api_returns_stable_errors():
    service=InMemoryRunService(max_workers=1);app=create_app(service)
    try:
        with TestClient(app) as client:
            missing=client.get("/api/runs/not-real")
            assert missing.status_code==404 and missing.json()["code"]=="run_not_found"
            malformed=client.post("/api/runs",json={"label":"missing config"})
            assert malformed.status_code==422 and malformed.json()["code"]=="run_request"
    finally:service.close()


def test_sse_stream_emits_snapshot_and_terminal_event():
    service=InMemoryRunService(max_workers=1);app=create_app(service)
    try:
        with TestClient(app) as client:
            response=client.post("/api/runs",json={"config":{"analysis":"pf","case":"ieee5","options":{
                "pf_method":"newton_raphson","tolerance":1e-10,"max_iter":50,"enforce_q_limits":False,
                "acceleration":1.4,"q_limit_tolerance":1e-6,"max_q_limit_switches":20,
            }}});run_id=response.json()["id"]
            for _ in range(200):
                if client.get(f"/api/runs/{run_id}").json()["status"]=="converged":break
                time.sleep(.01)
            events=[]
            with client.stream("GET",f"/api/runs/{run_id}/stream?fromSeq=0") as stream:
                for line in stream.iter_lines():
                    if line.startswith("data: "):events.append(json.loads(line[6:]))
            assert events[0]["type"]=="snapshot"
            assert events[-1]=={"type":"done","runId":run_id,"status":"converged"}
    finally:service.close()
