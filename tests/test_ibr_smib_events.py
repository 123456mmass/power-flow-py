import json
from pathlib import Path

import numpy as np
import pytest

from power_flow import PowerFlowError, solve_case


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ibr_smib_events.json"
EVENT_OPTIONS = {
    "ibr_analysis": "ts", "t_end": 0.03, "dt": 0.001,
    "fault_on": 0.01, "fault_clear": 0.02, "fault_impedance": 0.10j,
    "step_on": 0.01, "step_dv": -0.02, "step_dphase_deg": 2.0,
}


def test_smib_fault_and_grid_step_trajectories_match_matlab():
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert expected["schema"] == "power-flow-py/matlab-ibr-smib-events-oracle/1.0"
    for case in expected["cases"]:
        result = solve_case("ibr", case["case_id"], EVENT_OPTIONS)
        assert result.converged
        assert case["fault_enabled"] and case["step_enabled"]
        for actual, key in (
            (result.time, "t"), (result.fault_state, "x_fault"),
            (result.fault_voltage, "y_fault"), (result.step_state, "x_step"),
            (result.step_voltage, "y_step"),
        ):
            np.testing.assert_allclose(actual, case[key], rtol=0, atol=3e-13)


@pytest.mark.parametrize("case_id", [
    "gfl_reduced6_smib", "gfm_reduced6_smib", "gfl_rms10_smib",
    "gfm_no_pll_smib", "gfm_vsm_sakimoto_smib",
])
def test_event_boundary_uses_endpoint_grid_and_preserves_pre_event_equilibrium(case_id):
    result = solve_case("ibr", case_id, EVENT_OPTIONS)
    pre_event = result.time < EVENT_OPTIONS["fault_on"]
    assert np.max(np.abs(result.fault_state[pre_event] - result.x_equilibrium)) < 1e-14
    assert np.max(np.abs(result.step_state[pre_event] - result.x_equilibrium)) < 1e-14
    assert np.max(np.abs(result.fault_state[-1] - result.x_equilibrium)) > 1e-5
    assert np.max(np.abs(result.step_state[-1] - result.x_equilibrium)) > 1e-5


def test_events_are_opt_in_and_invalid_fault_fails_closed():
    result = solve_case("ibr", "gfl_reduced6_smib", {"ibr_analysis": "ts", "t_end": 0.01})
    assert result.fault_state is None and result.step_state is None
    with pytest.raises(PowerFlowError, match="nonzero impedance"):
        solve_case("ibr", "gfl_reduced6_smib", {
            "ibr_analysis": "ts", "fault_on": 0.01, "fault_clear": 0.02,
            "fault_impedance": 0j,
        })
    with pytest.raises(PowerFlowError, match="balanced LVRT floor"):
        solve_case("ibr", "gfl_rms10_smib", {
            "ibr_analysis": "ts", "t_end": 0.02, "dt": 0.001,
            "fault_on": 0.01, "fault_clear": 0.015, "fault_impedance": 0.001j,
        })
