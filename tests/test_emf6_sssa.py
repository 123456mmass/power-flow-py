from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow import solve_case
from power_flow.cases import load_case
from power_flow.sssa import solve_emf6_sssa


ORACLE = Path(__file__).resolve().parents[1] / "verification" / "fixtures" / "matlab_sssa_emf6.json"


def _spectrum_error(actual: np.ndarray, expected: np.ndarray) -> float:
    rows, columns = linear_sum_assignment(np.abs(actual[:, None] - expected[None, :]))
    return float(np.max(np.abs(actual[rows] - expected[columns])))


def test_emf6_equilibrium_and_linearization_match_matlab() -> None:
    expected = json.loads(ORACLE.read_text(encoding="utf-8"))
    assert expected["schema"] == "power-flow-py/matlab-emf6-sssa-oracle/1.0"
    result = solve_emf6_sssa(load_case("kundur"), {"load_model": "cc_p_cz_q"})
    np.testing.assert_array_equal(result.generator_bus_ids, expected["gen_buses"])
    np.testing.assert_allclose(result.x0, expected["x0"], atol=1e-13, rtol=0)
    np.testing.assert_allclose(result.y0, expected["y0"], atol=1e-13, rtol=0)
    np.testing.assert_allclose(result.jxx, expected["Jxx"], atol=1e-8, rtol=0)
    np.testing.assert_allclose(result.jxy, expected["Jxy"], atol=1e-8, rtol=0)
    np.testing.assert_allclose(result.jyx, expected["Jyx"], atol=1e-8, rtol=0)
    np.testing.assert_allclose(result.jyy, expected["Jyy"], atol=1e-8, rtol=0)
    np.testing.assert_allclose(result.a_full, expected["Afull"], atol=3e-9, rtol=0)
    np.testing.assert_allclose(result.a_reduced, expected["Ared"], atol=3e-9, rtol=0)
    reduced = np.asarray(expected["reduced_eigen_real"]) + 1j * np.asarray(
        expected["reduced_eigen_imag"]
    )
    assert _spectrum_error(result.reduced_eigenvalues, reduced) < 2e-9
    assert result.newton_iterations == expected["newton_iterations"]
    assert result.newton_residual < 1e-12
    np.testing.assert_allclose(result.dae.units.inertia, expected["H_system"], atol=1e-13, rtol=0)
    np.testing.assert_allclose(result.dae.units.damping, expected["D_system"], atol=1e-13, rtol=0)


def test_kundur_active_default_routes_to_emf6() -> None:
    result = solve_case("sssa", "kundur")
    assert result.model == "emf6"
    assert len(result.state_names) == 24
    assert result.a_reduced.shape == (22, 22)
    assert result.summary()["stability_status"] == "UNSTABLE"


def test_emf6_dae_is_at_equilibrium_and_angle_shift_invariant() -> None:
    result = solve_emf6_sssa(load_case("kundur"))
    np.testing.assert_allclose(result.dae.differential(result.x0, result.y0), 0, atol=1e-12, rtol=0)
    np.testing.assert_allclose(result.dae.network(result.x0, result.y0), 0, atol=1e-12, rtol=0)
    angle_shift = np.zeros(result.x0.size); angle_shift[0::6] = 1
    assert np.linalg.norm(result.a_full @ angle_shift, ord=np.inf) < 5e-9
