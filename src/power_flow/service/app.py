"""FastAPI adapter implementing the REST/SSE frontend contract."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI,Query,Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.sse import EventSourceResponse,ServerSentEvent

from power_flow.contracts import PowerFlowError
from power_flow.service.jobs import InMemoryRunService


def create_app(service: InMemoryRunService|None=None) -> FastAPI:
    owned=service is None;run_service=service or InMemoryRunService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        if owned:run_service.close()

    app=FastAPI(title="power-flow-py API",version="0.1.0",lifespan=lifespan)
    app.state.run_service=run_service
    app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:3000","http://127.0.0.1:3000"],
                       allow_credentials=True,allow_methods=["*"],allow_headers=["*"])

    @app.exception_handler(PowerFlowError)
    async def power_flow_error(_: Request,error: PowerFlowError) -> JSONResponse:
        status=404 if error.code.endswith("_not_found") or error.code=="run_not_found" else (409 if error.code in {"run_active","result_not_ready"} else 422)
        return JSONResponse(status_code=status,content={"code":error.code,"message":str(error)})

    @app.get("/api/cases")
    def cases() -> list[dict[str,Any]]:return run_service.cases()

    @app.get("/api/health")
    def health() -> dict[str,Any]:return run_service.health()

    @app.get("/api/stats")
    def stats() -> dict[str,Any]:return run_service.stats()

    @app.get("/api/runs")
    def list_runs(page: int=Query(1,ge=1),pageSize: int=Query(25,ge=1,le=200),search: str="",
                  status: str="",analysis: str="") -> dict[str,Any]:
        rows=run_service.list_runs()
        if search:
            needle=search.casefold();rows=[r for r in rows if needle in f"{r['id']} {r['label']} {r['caseId']}".casefold()]
        if status:
            allowed=set(status.split(","));rows=[r for r in rows if r["status"] in allowed]
        if analysis:
            allowed=set(analysis.split(","));rows=[r for r in rows if r["analysis"] in allowed]
        start=(page-1)*pageSize
        return {"items":rows[start:start+pageSize],"total":len(rows),"page":page,"pageSize":pageSize}

    @app.post("/api/runs",status_code=202)
    def submit_run(request: dict[str,Any]) -> dict[str,Any]:return run_service.submit(request)

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str) -> dict[str,Any]:return run_service.detail(run_id)

    @app.post("/api/runs/{run_id}/cancel")
    def cancel_run(run_id: str) -> dict[str,Any]:return run_service.cancel(run_id)

    @app.delete("/api/runs/{run_id}",status_code=204)
    def delete_run(run_id: str) -> None:run_service.delete(run_id)

    @app.get("/api/runs/{run_id}/result")
    def get_result(run_id: str) -> dict[str,Any]:return run_service.result(run_id)

    @app.get("/api/runs/{run_id}/stream",response_class=EventSourceResponse)
    def stream_run(run_id: str,fromSeq: int=Query(0,ge=0)) -> Iterator[ServerSentEvent]:
        snapshot=run_service.snapshot(run_id,fromSeq);cursor=run_service.event_cursor(run_id)
        yield ServerSentEvent(data=snapshot,id=str(cursor))
        while True:
            events,terminal=run_service.events_after(run_id,cursor)
            for seq,event in events:
                cursor=seq;yield ServerSentEvent(data=event,id=str(seq))
            if terminal:
                if not events or events[-1][1].get("type")!="done":
                    detail=run_service.detail(run_id)
                    yield ServerSentEvent(data={"type":"done","runId":run_id,"status":detail["status"]},id=str(cursor))
                return
            run_service.wait_for_events(run_id,cursor)

    @app.get("/api/presets")
    def presets() -> list[dict[str,Any]]:return run_service.presets()

    @app.post("/api/presets",status_code=201)
    def save_preset(value: dict[str,Any]) -> dict[str,Any]:return run_service.save_preset(value)

    @app.delete("/api/presets/{preset_id}",status_code=204)
    def delete_preset(preset_id: str) -> None:run_service.delete_preset(preset_id)

    @app.get("/api/audit")
    def audit(page: int=Query(1,ge=1),pageSize: int=Query(25,ge=1,le=200),search: str="",
              action: str="",runId: str="") -> dict[str,Any]:
        rows=run_service.audit()
        if search:
            needle=search.casefold();rows=[r for r in rows if needle in f"{r['user']} {r['detail']} {r['runId']}".casefold()]
        if action:rows=[r for r in rows if r["action"]==action]
        if runId:rows=[r for r in rows if r["runId"]==runId]
        start=(page-1)*pageSize
        return {"items":rows[start:start+pageSize],"total":len(rows),"page":page,"pageSize":pageSize}

    return app


def main() -> None:
    import uvicorn
    uvicorn.run("power_flow.service.app:create_app",factory=True,host="127.0.0.1",port=8000,reload=False)
