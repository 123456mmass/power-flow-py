"""Stable headless application API."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from power_flow.cases import load_case
from power_flow.contracts import PowerFlowError, PowerFlowOptions, PowerFlowResult
from power_flow.ibr import (
    IbrResult, LoadedIbrResult, TwoIbrSwitchResult, solve_loaded_smib_sweep,
    solve_reduced6_smib, solve_two_ibr_switch,
)
from power_flow.pf import (
    solve_bfs,
    solve_fdpf_bx,
    solve_fdpf_xb,
    solve_gauss_seidel,
    solve_newton_raphson,
)
from power_flow.sssa import solve_classical_sssa, solve_emf6_sssa, solve_padiyar_sssa
from power_flow.sssa.classical import SssaResult
from power_flow.sssa.emf6 import Emf6SssaResult
from power_flow.sssa.padiyar import PadiyarSssaResult
from power_flow.ts import Emf6TsResult, PadiyarTsResult, TsResult, simulate_classical, simulate_emf6, simulate_padiyar


ACTIVE_ANALYSES = ("pf", "sssa", "ts", "ibr")
IMPLEMENTED_ANALYSES = ("pf", "sssa", "ts", "ibr")
DETAILED_MODEL_DEFAULTS = {
    ("sssa", "padiyar_two_area"): "padiyar_1_1_avr",
    ("sssa", "kundur"): "emf6",
    ("ts", "padiyar_two_area"): "padiyar_1_1_avr",
    ("ts", "kundur"): "emf6",
}


def solve_case(
    analysis: str,
    case: str,
    options: Mapping[str, Any] | None = None,
) -> PowerFlowResult | SssaResult | Emf6SssaResult | PadiyarSssaResult | TsResult | Emf6TsResult | PadiyarTsResult | IbrResult | LoadedIbrResult | TwoIbrSwitchResult:
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
    if analysis_id == "ibr":
        if case.strip().lower() == "two_ibr_switch":
            return solve_two_ibr_switch(case, options)
        if case.strip().lower() in {"gfl_rms10_loaded_smib", "gfm_no_pll_loaded_smib"}:
            return solve_loaded_smib_sweep(case, options)
        return solve_reduced6_smib(case, options)
    power_case = load_case(case)
    if analysis_id == "sssa":
        default_model = DETAILED_MODEL_DEFAULTS.get((analysis_id, case.strip().lower()))
        requested_model = str((options or {}).get("model", default_model or "classical")).lower()
        if requested_model == "emf6":
            return solve_emf6_sssa(power_case, options)
        if requested_model in {"padiyar_1_1_avr", "padiyar_1_1_manual"}:
            return solve_padiyar_sssa(power_case, options)
        if default_model and requested_model != "classical":
            raise PowerFlowError(
                "default_model_not_implemented",
                f"The active default model {default_model!r} for this case is not implemented yet; "
                "request model='classical' explicitly to use the classical route.",
            )
        return solve_classical_sssa(power_case, options)
    if analysis_id == "ts":
        default_model = DETAILED_MODEL_DEFAULTS.get((analysis_id, case.strip().lower()))
        requested_model = str((options or {}).get("model", default_model or "classical")).lower()
        if requested_model == "emf6":
            return simulate_emf6(power_case, options)
        if requested_model in {"padiyar_1_1_avr", "padiyar_1_1_manual"}:
            return simulate_padiyar(power_case, options)
        if default_model and requested_model != "classical":
            raise PowerFlowError(
                "default_model_not_implemented",
                f"The active default model {default_model!r} for this case is not implemented yet; "
                "request model='classical' explicitly to use the classical route.",
            )
        return simulate_classical(power_case, options)
    resolved = PowerFlowOptions.from_mapping(options)
    solvers = {
        "newton_raphson": solve_newton_raphson,
        "gauss_seidel": solve_gauss_seidel,
        "fdpf_xb": solve_fdpf_xb,
        "fdpf_bx": solve_fdpf_bx,
        "bfs": solve_bfs,
    }
    return solvers[resolved.pf_method](power_case, resolved)
