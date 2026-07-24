from __future__ import annotations

import json

import pytest

from power_flow import PowerFlowError, solve_case
from power_flow.cli import main


def test_public_api_dispatches_pf() -> None:
    result = solve_case("PF", "IEEE5", {"tolerance": 1e-10})
    assert result.converged


def test_method_specific_default_iteration_budget() -> None:
    result = solve_case("pf", "ieee5", {"pf_method": "gauss_seidel", "tolerance": 1e-10})
    assert result.converged
    assert result.iterations == 25


def test_unimplemented_active_analysis_fails_closed() -> None:
    with pytest.raises(PowerFlowError) as caught:
        solve_case("sssa", "ieee5")
    assert caught.value.code == "analysis_not_implemented"


def test_cli_emits_json(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--case", "ieee5", "--tolerance", "1e-10"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["converged"] is True
    assert payload["reason"] == "converged"
