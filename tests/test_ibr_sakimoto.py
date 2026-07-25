import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow import solve_case


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ibr_sakimoto.json"


def test_sakimoto_smib_matches_matlab_equations_spectrum_and_tds():
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    result = solve_case(
        "ibr", expected["case_id"], {"ibr_analysis": "full", "t_end": 0.01, "dt": 0.001}
    )
    for actual, key, tolerance in (
        (result.x_equilibrium, "x0", 1e-14), (result.y_equilibrium, "y0", 0),
        (result.u_equilibrium, "u0", 1e-14), (result.f_residual, "f0", 1e-12),
        (result.g_residual, "g0", 1e-14), (result.fx, "fx", 1e-12),
        (result.fy, "fy", 1e-12), (result.gx, "gx", 1e-12),
        (result.gy, "gy", 1e-9), (result.state_matrix, "A", 5e-8),
        (result.time, "t", 0), (result.drift_state, "x_drift", 1e-14),
        (result.drift_voltage, "y_drift", 1e-14),
        (result.perturbed_state, "x_perturbed", 3e-13),
        (result.perturbed_voltage, "y_perturbed", 3e-13),
        (result.newton_residual, "newton_residual", 1e-14),
    ):
        np.testing.assert_allclose(actual, expected[key], rtol=0, atol=tolerance)
    matlab_eigenvalues = np.asarray(expected["eigen_real"]) + 1j * np.asarray(expected["eigen_imag"])
    cost = np.abs(result.eigenvalues[:, None] - matlab_eigenvalues[None, :])
    rows, columns = linear_sum_assignment(cost)
    assert np.max(cost[rows, columns]) < 3e-8
    assert result.converged
    assert result.stability_status == "ASYMPTOTICALLY STABLE"
    assert result.max_equilibrium_drift == expected["max_drift"] == 0


def test_sakimoto_state_inventory_has_no_pll_avr_or_pss():
    result = solve_case("ibr", "gfm_vsm_sakimoto_smib", {"ibr_analysis": "sssa"})
    assert result.state_names == (
        "i_d", "i_q", "xi_id", "xi_iq", "omega_R", "delta", "x_gov", "T_m", "x_d"
    )
    forbidden = ("pll", "avr", "pss")
    assert not any(any(word in name.lower() for word in forbidden) for name in result.state_names)
    assert result.x_equilibrium.size == 9
    assert np.max(result.eigenvalues.real) < 0


def test_sakimoto_angle_derivative_is_swing_only():
    result = solve_case("ibr", "gfm_vsm_sakimoto_smib", {"ibr_analysis": "sssa"})
    # Row 6 is d(delta)/dt. Its only state derivative is omega_b with respect
    # to omega_R (state 5); it has no terminal-voltage or delta self coupling.
    np.testing.assert_allclose(result.fx[5, 4], 2 * np.pi * 60, rtol=2e-10, atol=0)
    assert abs(result.fx[5, 5]) < 1e-12
    assert np.max(np.abs(result.fy[5])) < 1e-12
