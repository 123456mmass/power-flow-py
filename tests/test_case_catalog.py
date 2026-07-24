from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from power_flow import PowerFlowOptions
from power_flow.cases import CASE_REGISTRY, catalog_ids, load_case
from power_flow.pf import solve_newton_raphson


ORACLE = Path(__file__).resolve().parents[1] / "verification" / "fixtures" / "matlab_pf_catalog.json"
EXPECTED_IDS = (
    "ieee5", "ieee14", "ieee300", "rts24", "padiyar_two_area", "kundur_two_area",
    "matpower14", "case9", "matpower30", "saadat67", "saadat68", "ieee30", "template",
    "kundur",
)


def test_active_network_catalog_is_complete() -> None:
    assert tuple(CASE_REGISTRY) == EXPECTED_IDS
    assert catalog_ids() == EXPECTED_IDS
    for case_id in EXPECTED_IDS:
        case = load_case(case_id)
        assert case.schema_version == "power_case/1.0"
        assert case.bus_data.shape[1] == 12
        assert case.line_data.shape[1] == 7
        assert case.bus_data.flags.writeable is False
        assert case.line_data.flags.writeable is False


def test_every_active_network_case_matches_matlab_pf() -> None:
    payload = json.loads(ORACLE.read_text(encoding="utf-8"))
    assert payload["schema"] == "power-flow-py/matlab-pf-catalog-oracle/1.0"
    options = PowerFlowOptions(max_iter=50, tolerance=1e-10, enforce_q_limits=False)
    assert tuple(item["case_id"] for item in payload["cases"]) == EXPECTED_IDS
    for expected in payload["cases"]:
        result = solve_newton_raphson(load_case(expected["case_id"]), options)
        assert result.converged == expected["converged"]
        assert result.iterations == expected["iterations"]
        np.testing.assert_allclose(result.bus_voltage, expected["bus_voltage"], atol=3e-14, rtol=0)
        np.testing.assert_allclose(result.bus_angle_deg, expected["bus_angle_deg"], atol=3e-12, rtol=0)
        np.testing.assert_allclose(result.p_generation, expected["p_generation"], atol=5e-13, rtol=0)
        # IEEE300's dense linear solve amplifies platform roundoff into Q by
        # roughly 7e-13; keep the cross-runtime gate at a strict 1e-12.
        np.testing.assert_allclose(result.q_generation, expected["q_generation"], atol=1e-12, rtol=0)
        assert abs(result.p_loss_total - expected["p_loss_total"]) < 2e-13
        assert abs(result.q_loss_total - expected["q_loss_total"]) < 2e-12
