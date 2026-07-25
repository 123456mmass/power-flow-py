import json
from pathlib import Path

import numpy as np
import pytest
from scipy.optimize import linear_sum_assignment

from power_flow import PowerFlowError, solve_case


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ibr_loaded_sweep.json"


def test_loaded_smib_sweeps_match_matlab_equilibria_and_sssa():
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert expected["schema"] == "power-flow-py/matlab-ibr-loaded-sweep-oracle/1.0"
    for expected_case in expected["cases"]:
        result = solve_case("ibr", expected_case["case_id"])
        assert result.converged
        np.testing.assert_array_equal(result.load_percentages, expected_case["load_percentages"])
        for actual, oracle in zip(result.points, expected_case["points"]):
            assert actual.iterations == oracle["iterations"]
            for value, key, tolerance in (
                (actual.x_equilibrium,"x0",1e-12), (actual.y_equilibrium,"y0",1e-12),
                (actual.u_equilibrium,"u0",0), (actual.f_residual,"f0",3e-11),
                (actual.g_residual,"g0",3e-12), (actual.fx,"fx",4e-7),
                (actual.fy,"fy",4e-7), (actual.gx,"gx",6e-10),
                (actual.gy,"gy",2e-10), (actual.state_matrix,"A",3e-6),
            ):
                np.testing.assert_allclose(value, oracle[key], rtol=0, atol=tolerance)
            matlab_eigenvalues = np.asarray(oracle["eigen_real"]) + 1j*np.asarray(oracle["eigen_imag"])
            cost = np.abs(actual.eigenvalues[:,None] - matlab_eigenvalues[None,:])
            rows,columns = linear_sum_assignment(cost)
            assert np.max(cost[rows,columns]) < 3e-7


@pytest.mark.parametrize("case_id,state_count", [
    ("gfl_rms10_loaded_smib",10), ("gfm_no_pll_loaded_smib",4),
])
def test_loaded_sweep_scales_only_load_and_preserves_spectrum(case_id,state_count):
    result = solve_case("ibr",case_id)
    assert len(result.points) == 5
    np.testing.assert_allclose(result.load_scales,[1,1.2,1.4,1.6,1.8],rtol=0,atol=1e-15)
    terminal_magnitudes=[]
    for index,point in enumerate(result.points):
        assert point.eigenvalues.size == state_count
        assert point.p_load == pytest.approx(0.4*result.load_scales[index])
        assert point.q_load == pytest.approx(0.1*result.load_scales[index])
        assert point.u_equilibrium[0] == 0.4
        terminal_magnitudes.append(abs(complex(*point.y_equilibrium)))
        np.testing.assert_allclose(
            np.sort_complex(result.tracked_eigenvalues[index]),
            np.sort_complex(point.eigenvalues),rtol=0,atol=0,
        )
    assert np.all(np.diff(terminal_magnitudes) < 0)


@pytest.mark.parametrize("percentages", [
    (20,20,40), (20,40,30), (-5,20), (20,float("nan")), (),
])
def test_invalid_loaded_sweep_percentages_fail_closed(percentages):
    with pytest.raises(PowerFlowError):
        solve_case("ibr","gfl_rms10_loaded_smib",{
            "ibr_analysis":"sssa_load_sweep","sssa_load_percentages":percentages,
        })


def test_ideal_smib_rejects_loaded_sweep_product():
    with pytest.raises(PowerFlowError,match="pf, sssa, ts, or full"):
        solve_case("ibr","gfl_rms10_smib",{"ibr_analysis":"sssa_load_sweep"})
