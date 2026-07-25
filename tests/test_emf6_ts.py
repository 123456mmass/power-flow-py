import json
from pathlib import Path

import numpy as np

from power_flow import load_case, solve_case
from power_flow.ts import Emf6TsResult, simulate_emf6


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ts_emf6.json"
OPTIONS = {
    "model": "emf6", "t_end": 0.02, "dt": 0.005, "fault_bus": 7,
    "t_fault": 0.005, "t_clear": 0.01, "fault_impedance": 0.1j,
    "corrector_mode": "fixed", "corrector_iter": 3,
}


def test_emf6_fault_trajectory_matches_matlab_oracle():
    oracle = json.loads(FIXTURE.read_text(encoding="utf-8"))
    result = simulate_emf6(load_case("kundur"), OPTIONS)
    np.testing.assert_allclose(result.time, oracle["t"], rtol=0, atol=1e-15)
    np.testing.assert_allclose(result.delta, oracle["delta"], rtol=0, atol=2e-13)
    np.testing.assert_allclose(result.omega, oracle["omega"], rtol=0, atol=2e-15)
    np.testing.assert_allclose(result.electrical_power, oracle["Pe_pu"], rtol=0, atol=3e-13)
    np.testing.assert_allclose(result.bus_voltage, oracle["Vbus"], rtol=0, atol=2e-13)
    np.testing.assert_allclose(
        result.corrector_residual, oracle["corrector_residual"], rtol=0, atol=2e-15
    )
    np.testing.assert_allclose(
        result.algebraic_residual, oracle["integrator_algebraic_residual"], rtol=0, atol=1e-12
    )
    assert np.max(result.algebraic_residual) < 1e-12
    np.testing.assert_array_equal(result.event_indices, np.asarray(oracle["event_idx"]) - 1)
    np.testing.assert_array_equal(result.event_side, oracle["event_side"])
    assert abs(result.initial_dae_residual - oracle["initial_dae_residual"]) < 1e-12


def test_kundur_ts_defaults_to_operational_emf6_when_options_are_present():
    result = solve_case("ts", "kundur", OPTIONS)
    assert isinstance(result, Emf6TsResult)
    assert result.model == "emf6"
    assert result.initial_dae_residual < 1e-10
    assert result.nonconverged_step_count == 0
    assert result.metadata["fallback_used"] is False


def test_emf6_no_fault_preserves_shared_dae_equilibrium():
    result = simulate_emf6(
        load_case("kundur"),
        {"t_end": 0.02, "dt": 0.01, "fault_enabled": False},
    )
    assert np.max(np.abs(result.delta[-1] - result.delta[0])) < 1e-12
    assert np.max(np.abs(result.omega)) < 1e-12
    assert np.max(np.abs(result.bus_voltage[-1] - result.bus_voltage[0])) < 1e-12
    assert result.event_indices.size == 0
