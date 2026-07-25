from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from power_flow import PowerFlowError, solve_case
from power_flow.cases import CASE_REGISTRY, load_case
from power_flow.ts import simulate_classical


ORACLE = Path(__file__).resolve().parents[1] / "verification" / "fixtures" / "matlab_ts_classical.json"
BASE_OPTIONS = {
    "model": "classical", "t_end": 0.12, "dt": 0.01, "fault_bus": 4,
    "t_fault": 0.05, "t_clear": 0.10, "fault_impedance": 0.1j,
    "pm_mode": "pgaz", "corrector_mode": "adaptive", "max_corrector_iter": 10,
    "corrector_abs_tol": 1e-10, "corrector_rel_tol": 1e-8,
}


@pytest.mark.parametrize("integrator", ["trapezoidal", "rk4", "backward_euler"])
def test_fixed_integrator_trajectory_matches_matlab(integrator: str) -> None:
    payload = json.loads(ORACLE.read_text(encoding="utf-8"))
    assert payload["schema"] == "power-flow-py/matlab-classical-ts-oracle/1.0"
    expected = next(item for item in payload["cases"] if item["integrator"] == integrator)
    result = simulate_classical(load_case("matpower14"), {**BASE_OPTIONS, "integrator": integrator})
    np.testing.assert_allclose(result.time, expected["t"], atol=2e-16, rtol=0)
    np.testing.assert_allclose(result.delta, expected["delta"], atol=2e-14, rtol=0)
    np.testing.assert_allclose(result.omega, expected["omega"], atol=2e-14, rtol=0)
    np.testing.assert_array_equal(result.corrector_iterations, expected["corrector_iterations"])
    np.testing.assert_allclose(result.corrector_residual, expected["corrector_residual"], atol=1e-14, rtol=0)

    # The audited MATLAB fixed-step recorder compares raw binary t_next at
    # t_clear and publishes the faulted left limit there. The declared event
    # contract requires the post-fault right limit, which Python publishes.
    clear_index = int(np.flatnonzero(result.time == BASE_OPTIONS["t_clear"])[0])
    mask = np.arange(result.time.size) != clear_index
    np.testing.assert_allclose(result.electrical_power[mask], np.asarray(expected["Pe_pu"])[mask], atol=2e-13, rtol=0)
    np.testing.assert_allclose(result.bus_voltage[mask], np.asarray(expected["Vbus"])[mask], atol=2e-13, rtol=0)
    assert result.bus_voltage[clear_index, 3] > expected["Vbus"][clear_index][3] * 1.5


def test_event_samples_are_right_limit_and_state_is_continuous() -> None:
    result = simulate_classical(load_case("matpower14"), BASE_OPTIONS)
    fault_index, clear_index = result.event_indices
    assert result.event_side[fault_index] == 1
    assert result.event_side[clear_index] == 1
    assert result.bus_voltage[fault_index, 3] < result.bus_voltage[fault_index - 1, 3] * 0.95
    assert result.bus_voltage[clear_index, 3] > result.bus_voltage[clear_index - 1, 3] * 1.5
    np.testing.assert_allclose(result.delta[fault_index], result.delta[fault_index - 1], atol=1e-12, rtol=0)


def test_every_active_case_runs_classical_no_fault_smoke() -> None:
    for case_id in CASE_REGISTRY:
        result = simulate_classical(
            load_case(case_id),
            {"model": "classical", "t_end": 0.02, "dt": 0.01, "fault_enabled": False},
        )
        assert result.time.size == 3
        assert np.all(np.isfinite(result.delta))
        assert np.all(np.isfinite(result.omega))
        assert np.all(np.isfinite(result.bus_voltage))


def test_ts_public_api_and_unknown_integrator() -> None:
    result = solve_case(
        "ts", "case9", {"model": "classical", "t_end": 0.02, "dt": 0.01,
                         "fault_enabled": False},
    )
    assert result.summary()["analysis"] == "ts"
    with pytest.raises(PowerFlowError) as caught:
        simulate_classical(load_case("case9"), {"integrator": "bogus"})
    assert caught.value.code == "ts_integrator"
