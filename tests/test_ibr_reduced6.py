import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow import PowerFlowError, solve_case
from power_flow.ibr import IbrResult


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ibr_reduced6.json"


def _assigned_error(left: np.ndarray, right: np.ndarray) -> float:
    cost = np.abs(left[:, None] - right[None, :])
    rows, columns = linear_sum_assignment(cost)
    return float(np.max(cost[rows, columns]))


def test_reduced6_smib_equations_and_trajectories_match_matlab():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for expected in fixture["cases"]:
        result = solve_case(
            "ibr", expected["case_id"], {"ibr_analysis": "full", "t_end": 0.01, "dt": 0.001}
        )
        assert isinstance(result, IbrResult)
        for actual, key, tolerance in (
            (result.x_equilibrium, "x0", 1e-14), (result.y_equilibrium, "y0", 0),
            (result.u_equilibrium, "u0", 1e-14), (result.f_residual, "f0", 1e-12),
            (result.g_residual, "g0", 1e-14), (result.fx, "fx", 1e-12),
            (result.fy, "fy", 1e-12), (result.gx, "gx", 1e-12),
            (result.gy, "gy", 1e-9), (result.state_matrix, "A", 3e-9),
            (result.time, "t", 0), (result.drift_state, "x_drift", 1e-14),
            (result.drift_voltage, "y_drift", 1e-14),
            (result.perturbed_state, "x_perturbed", 2e-13),
            (result.perturbed_voltage, "y_perturbed", 2e-13),
            (result.newton_residual, "newton_residual", 1e-14),
        ):
            np.testing.assert_allclose(actual, expected[key], rtol=0, atol=tolerance)
        matlab_eigenvalues = np.asarray(expected["eigen_real"]) + 1j * np.asarray(expected["eigen_imag"])
        assert _assigned_error(result.eigenvalues, matlab_eigenvalues) < 2e-9
        assert result.infinite_bus_voltage == complex(expected["Vinf_real"], expected["Vinf_imag"])
        assert result.line_impedance == complex(expected["Z_real"], expected["Z_imag"])
        assert result.max_equilibrium_drift == expected["max_drift"] == 0
        assert result.converged
        assert result.stability_status == "ASYMPTOTICALLY STABLE"
        assert result.metadata["fallback_used"] is False


def test_ibr_product_stages_are_explicit():
    pf = solve_case("ibr", "gfl_reduced6_smib", {"ibr_analysis": "pf"})
    assert pf.state_matrix is None and pf.time is None
    sssa = solve_case("ibr", "gfm_reduced6_smib", {"ibr_analysis": "sssa"})
    assert sssa.state_matrix is not None and sssa.time is None
    ts = solve_case("ibr", "gfl_reduced6_smib", {"ibr_analysis": "ts", "t_end": 0.002})
    assert ts.state_matrix is not None and ts.time.size == 3


def test_unported_ibr_case_fails_closed():
    try:
        solve_case("ibr", "unported_multibus_ibr")
    except PowerFlowError as error:
        assert error.code == "ibr_case_not_implemented"
    else:
        raise AssertionError("Unported IBR case must fail closed.")
