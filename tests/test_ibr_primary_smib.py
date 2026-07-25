import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow import solve_case


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ibr_primary_smib.json"


def _assigned_error(left: np.ndarray, right: np.ndarray) -> float:
    cost = np.abs(left[:, None] - right[None, :])
    rows, columns = linear_sum_assignment(cost)
    return float(np.max(cost[rows, columns]))


def test_primary_smib_models_match_matlab_equations_and_tds():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for expected in fixture["cases"]:
        result = solve_case(
            "ibr", expected["case_id"], {"ibr_analysis": "full", "t_end": 0.01, "dt": 0.001}
        )
        matrix_tolerance = 1e-6 if expected["kind"] == "gfl_rms10" else 2e-9
        for actual, key, tolerance in (
            (result.x_equilibrium, "x0", 1e-14), (result.y_equilibrium, "y0", 0),
            (result.u_equilibrium, "u0", 1e-14), (result.f_residual, "f0", 1e-12),
            (result.g_residual, "g0", 1e-14), (result.fx, "fx", matrix_tolerance),
            (result.fy, "fy", matrix_tolerance), (result.gx, "gx", 1e-12),
            (result.gy, "gy", 1e-9), (result.state_matrix, "A", matrix_tolerance),
            (result.time, "t", 0), (result.drift_state, "x_drift", 1e-14),
            (result.drift_voltage, "y_drift", 1e-14),
            (result.perturbed_state, "x_perturbed", 5e-13),
            (result.perturbed_voltage, "y_perturbed", 5e-13),
            (result.newton_residual, "newton_residual", 1e-14),
        ):
            np.testing.assert_allclose(actual, expected[key], rtol=0, atol=tolerance)
        matlab_eigenvalues = np.asarray(expected["eigen_real"]) + 1j * np.asarray(expected["eigen_imag"])
        spectrum_tolerance = 2e-7 if expected["kind"] == "gfl_rms10" else 2e-9
        assert _assigned_error(result.eigenvalues, matlab_eigenvalues) < spectrum_tolerance
        assert result.converged
        assert result.stability_status == "ASYMPTOTICALLY STABLE"
        assert result.max_equilibrium_drift == expected["max_drift"] == 0


def test_gfl_rms10_fixed_state_contract_and_fast_pll_pole():
    result = solve_case("ibr", "gfl_rms10_smib", {"ibr_analysis": "sssa"})
    assert result.state_names == (
        "delta_PLL", "xi_PLL", "P_f", "Q_f", "xi_P", "xi_Q",
        "xi_id", "xi_iq", "i_d", "i_q",
    )
    assert result.x_equilibrium.size == 10
    assert np.min(result.eigenvalues.real) < -3e5
    assert np.max(result.eigenvalues.real) < 0


def test_gfm_no_pll_has_only_virtual_rotor_and_power_filter_states():
    result = solve_case("ibr", "gfm_no_pll_smib", {"ibr_analysis": "sssa"})
    assert result.state_names == ("delta_vsm", "delta_omega_vsm", "P_f", "Q_f")
    assert not any("PLL" in name for name in result.state_names)
    assert result.x_equilibrium.size == 4
    assert np.max(result.eigenvalues.real) < 0
