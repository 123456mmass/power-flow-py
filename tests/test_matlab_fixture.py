from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from power_flow import PowerFlowOptions, solve_case
from power_flow.network import build_jacobian, calculate_mismatch, initial_state, prepare_case
from power_flow.cases import load_case


FIXTURE = Path(__file__).resolve().parents[1] / "verification" / "fixtures" / "matlab_pf_baseline.json"


def test_frozen_matlab_pf_fixture() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert payload["schema"] == "power-flow-py/matlab-pf-oracle/1.0"
    options = PowerFlowOptions(
        tolerance=float(payload["options"]["tolerance"]),
        max_iter=int(payload["options"]["max_iter"]),
        enforce_q_limits=bool(payload["options"]["enforce_q_limits"]),
    )
    for expected in payload["cases"]:
        case_id = expected["case_id"]
        result = solve_case(
            "pf",
            case_id,
            {
                "tolerance": options.tolerance,
                "max_iter": options.max_iter,
                "enforce_q_limits": options.enforce_q_limits,
            },
        )
        assert result.converged == expected["converged"]
        assert result.reason == expected["reason"]
        assert result.finite_status == expected["finite_status"]
        assert result.iterations == expected["iterations"]
        np.testing.assert_allclose(result.bus_voltage, expected["bus_voltage"], atol=2e-12, rtol=0)
        np.testing.assert_allclose(result.bus_angle_deg, expected["bus_angle_deg"], atol=2e-10, rtol=0)
        np.testing.assert_allclose(result.p_generation, expected["p_generation"], atol=2e-11, rtol=0)
        np.testing.assert_allclose(result.q_generation, expected["q_generation"], atol=2e-11, rtol=0)
        np.testing.assert_allclose(result.mismatch_history, expected["mismatch_history"], atol=2e-12, rtol=0)
        np.testing.assert_allclose(result.ybus.real, expected["ybus_real"], atol=2e-13, rtol=0)
        np.testing.assert_allclose(result.ybus.imag, expected["ybus_imag"], atol=2e-13, rtol=0)
        assert abs(result.p_loss_total - expected["p_loss_total"]) < 2e-12
        assert abs(result.q_loss_total - expected["q_loss_total"]) < 2e-12

        model = prepare_case(load_case(case_id))
        state = initial_state(model)
        mismatch, p_calc, q_calc, voltage, angle = calculate_mismatch(state, model)
        jacobian = build_jacobian(voltage, angle, p_calc, q_calc, model)
        np.testing.assert_allclose(mismatch, expected["initial_mismatch"], atol=2e-13, rtol=0)
        np.testing.assert_allclose(jacobian, expected["initial_jacobian"], atol=2e-12, rtol=0)
