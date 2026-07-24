"""Stable headless application API."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from power_flow.cases import load_case
from power_flow.contracts import PowerFlowError, PowerFlowOptions, PowerFlowResult
from power_flow.pf import (
    solve_bfs,
    solve_fdpf_bx,
    solve_fdpf_xb,
    solve_gauss_seidel,
    solve_newton_raphson,
)
from power_flow.sssa import solve_classical_sssa
from power_flow.sssa.classical import SssaResult


ACTIVE_ANALYSES = ("pf", "sssa", "ts", "ibr")
IMPLEMENTED_ANALYSES = ("pf", "sssa")


def solve_case(
    analysis: str,
    case: str,
    options: Mapping[str, Any] | None = None,
) -> PowerFlowResult | SssaResult:
    analysis_id = analysis.strip().lower()
    if analysis_id not in ACTIVE_ANALYSES:
        raise PowerFlowError(
            "unknown_analysis",
            f"Unknown analysis {analysis!r}; expected one of {', '.join(ACTIVE_ANALYSES)}.",
        )
    if analysis_id not in IMPLEMENTED_ANALYSES:
        raise PowerFlowError(
            "analysis_not_implemented",
            f"Analysis {analysis_id!r} is active in the source baseline but not implemented yet.",
        )
    power_case = load_case(case)
    if analysis_id == "sssa":
        return solve_classical_sssa(power_case, options)
    resolved = PowerFlowOptions.from_mapping(options)
    solvers = {
        "newton_raphson": solve_newton_raphson,
        "gauss_seidel": solve_gauss_seidel,
        "fdpf_xb": solve_fdpf_xb,
        "fdpf_bx": solve_fdpf_bx,
        "bfs": solve_bfs,
    }
    return solvers[resolved.pf_method](power_case, resolved)
