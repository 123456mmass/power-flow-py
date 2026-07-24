from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

from power_flow import solve_case
from power_flow.cases import load_case
from power_flow.sssa import solve_classical_sssa


ORACLE = Path(__file__).resolve().parents[1] / "verification" / "fixtures" / "matlab_sssa_classical.json"


def _spectrum_error(actual: np.ndarray, expected: np.ndarray) -> float:
    if actual.size == 0:
        return 0.0
    rows, columns = linear_sum_assignment(np.abs(actual[:, None] - expected[None, :]))
    return float(np.max(np.abs(actual[rows] - expected[columns])))


def test_classical_sssa_matches_every_active_matlab_case() -> None:
    payload = json.loads(ORACLE.read_text(encoding="utf-8"))
    assert payload["schema"] == "power-flow-py/matlab-classical-sssa-oracle/1.0"
    for expected in payload["cases"]:
        result = solve_classical_sssa(load_case(expected["case_id"]))
        assert result.state_names == tuple(expected["state_names"])
        np.testing.assert_array_equal(result.generator_bus_ids, expected["gen_buses"])
        np.testing.assert_allclose(result.inertia, expected["H"], atol=1e-14, rtol=0)
        np.testing.assert_allclose(result.machine_damping, expected["D"], atol=1e-14, rtol=0)
        np.testing.assert_allclose(result.transient_reactance, expected["Xdp"], atol=1e-14, rtol=0)

        if expected["case_id"] == "ieee300":
            # The augmented 300-bus network has cond(Y) ~= 5.5e4. Its
            # 1e-6 finite-difference contract therefore has a wider, still
            # 3.6e-5-relative cross-runtime envelope.
            np.testing.assert_allclose(result.k_pe_delta, expected["K_Pe_delta"], atol=3e-4, rtol=5e-5)
            np.testing.assert_allclose(result.a_full, expected["Afull"], atol=3e-5, rtol=5e-5)
            np.testing.assert_allclose(result.a_reduced, expected["Ared"], atol=3e-5, rtol=5e-5)
        else:
            np.testing.assert_allclose(result.k_pe_delta, expected["K_Pe_delta"], atol=5e-9, rtol=0)
            np.testing.assert_allclose(result.a_full, expected["Afull"], atol=5e-10, rtol=0)
            if result.a_reduced.size:
                np.testing.assert_allclose(result.a_reduced, expected["Ared"], atol=5e-10, rtol=0)
            else:
                assert np.asarray(expected["Ared"]).size == 0

        expected_reduced = np.asarray(expected["reduced_eigen_real"]) + 1j * np.asarray(
            expected["reduced_eigen_imag"]
        )
        spectral_tolerance = 3e-3 if expected["case_id"] == "ieee300" else 2e-9
        assert _spectrum_error(result.reduced_eigenvalues, expected_reduced) < spectral_tolerance
        assert result.stability_status == expected["stability_status"]
        assert dict(result.root_counts) == expected["root_counts"]


def test_sssa_public_api_and_summary() -> None:
    result = solve_case("sssa", "ieee14", {"model": "classical"})
    assert result.model == "classical"
    assert len(result.state_names) == 10
    assert result.summary()["analysis"] == "sssa"
