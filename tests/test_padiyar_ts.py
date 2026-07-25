import json
from pathlib import Path

import numpy as np

from power_flow import load_case, solve_case
from power_flow.ts import PadiyarTsResult, simulate_padiyar


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ts_padiyar.json"
OPTIONS = {
    "model": "padiyar_1_1_avr", "t_end": 0.02, "dt": 0.005,
    "fault_bus": 3, "t_fault": 0.005, "t_clear": 0.01,
    "fault_impedance": 0.1j,
}


def test_padiyar_avr_fault_trajectory_matches_matlab_oracle():
    oracle = json.loads(FIXTURE.read_text(encoding="utf-8"))
    result = simulate_padiyar(load_case("padiyar_two_area"), OPTIONS)
    np.testing.assert_allclose(result.time, oracle["t"], rtol=0, atol=1e-15)
    for actual, key, tolerance in (
        (result.delta, "delta", 2e-13), (result.omega, "omega", 2e-15),
        (result.eqp, "Eqp", 2e-13), (result.edp, "Edp", 2e-13),
        (result.efd, "Efd", 3e-13), (result.electrical_power, "Pe_pu", 3e-13),
        (result.reactive_power, "Qe_pu", 3e-13), (result.bus_voltage, "Vbus", 2e-13),
    ):
        np.testing.assert_allclose(actual, oracle[key], rtol=0, atol=tolerance)
    np.testing.assert_array_equal(result.corrector_iterations, oracle["corrector_iterations"])
    np.testing.assert_array_equal(result.corrector_converged, oracle["corrector_converged"])
    np.testing.assert_allclose(result.corrector_residual, oracle["corrector_residual"], rtol=0, atol=5e-13)
    np.testing.assert_allclose(result.corrector_update_norm, oracle["corrector_update_norm"], rtol=0, atol=5e-13)
    np.testing.assert_allclose(result.algebraic_residual, oracle["integrator_algebraic_residual"], rtol=0, atol=1e-12)
    assert result.initial_dae_residual < 1e-10
    assert result.nonconverged_step_count == 0


def test_padiyar_ts_default_api_route_is_operational_avr():
    result = solve_case("ts", "padiyar_two_area", OPTIONS)
    assert isinstance(result, PadiyarTsResult)
    assert result.model == "padiyar_1_1_avr"
    assert result.excitation == "avr"
    assert result.metadata["fallback_used"] is False


def test_padiyar_manual_no_fault_preserves_equilibrium():
    result = simulate_padiyar(
        load_case("padiyar_two_area"),
        {"model": "padiyar_1_1_manual", "t_end": 0.02, "dt": 0.01, "fault_enabled": False},
    )
    assert result.eqp.shape == (3, 4)
    assert np.all(np.isnan(result.efd))
    assert np.max(np.abs(result.delta[-1] - result.delta[0])) < 1e-12
    assert np.max(np.abs(result.omega - 1)) < 1e-12
    assert result.event_indices.size == 0
