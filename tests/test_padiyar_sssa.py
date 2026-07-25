import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow import load_case, solve_case
from power_flow.sssa import PadiyarSssaResult, solve_padiyar_sssa


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_sssa_padiyar.json"


def _assigned_error(left: np.ndarray, right: np.ndarray) -> float:
    cost = np.abs(left[:, None] - right[None, :])
    rows, columns = linear_sum_assignment(cost)
    return float(np.max(cost[rows, columns]))


def test_avr_and_manual_dae_matrices_match_matlab_oracle():
    oracle = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for expected in oracle["cases"]:
        excitation = expected["excitation"]
        result = solve_padiyar_sssa(
            load_case("padiyar_two_area"), {"model": f"padiyar_1_1_{excitation}"}
        )
        np.testing.assert_allclose(result.x0, expected["x0"], rtol=0, atol=3e-13)
        np.testing.assert_allclose(result.y0, expected["y0"], rtol=0, atol=3e-14)
        matrix_tolerance = 4e-6 if excitation == "avr" else 3e-8
        for actual, key in (
            (result.jxx, "Jxx"), (result.jxy, "Jxy"),
            (result.jyx, "Jyx"), (result.jyy, "Jyy"), (result.a_full, "Afull"),
        ):
            np.testing.assert_allclose(actual, expected[key], rtol=0, atol=matrix_tolerance)
        matlab_eigenvalues = np.asarray(expected["eigen_real"]) + 1j * np.asarray(expected["eigen_imag"])
        # The two reference/gauge roots are FD-sensitive and are tested structurally below.
        python_physical = np.delete(result.eigenvalues, np.argsort(np.abs(result.eigenvalues))[:2])
        matlab_physical = np.delete(matlab_eigenvalues, np.argsort(np.abs(matlab_eigenvalues))[:2])
        spectrum_tolerance = 2e-8 if excitation == "avr" else 1e-6
        assert _assigned_error(python_physical, matlab_physical) < spectrum_tolerance
        np.testing.assert_array_equal(result.generator_bus_ids, expected["gen_buses"])
        np.testing.assert_allclose(result.dae.units.inertia, expected["H"], rtol=0, atol=0)
        assert result.newton_iterations == expected["newton_iterations"]
        assert result.newton_residual < 1e-10
        assert result.angle_shift_residual < 3e-6


def test_padiyar_default_api_route_is_operational_avr():
    result = solve_case("sssa", "padiyar_two_area")
    assert isinstance(result, PadiyarSssaResult)
    assert result.model == "padiyar_1_1_avr"
    assert result.excitation == "avr"
    assert result.x0.size == 20
    assert result.root_counts == {"unstable": 0, "stable": 18, "marginal": 2}


def test_manual_variant_uses_four_states_per_machine():
    result = solve_case("sssa", "padiyar_two_area", {"model": "padiyar_1_1_manual"})
    assert isinstance(result, PadiyarSssaResult)
    assert result.excitation == "manual"
    assert result.x0.size == 16
    assert result.dae.states_per_machine == 4
