import json
from pathlib import Path

import numpy as np
import pytest

from power_flow import PowerFlowError, solve_case


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ieee14_switch.json"


def _sorted_eigenvalues(values):
    values=np.asarray(values,dtype=complex)
    return values[np.lexsort((values.imag,values.real))]


def _combined_state(result):
    y=np.empty((result.time.size,28))
    y[:,0::2]=result.bus_voltage.real;y[:,1::2]=result.bus_voltage.imag
    return np.column_stack((result.state,y))


def test_ieee14_switch_pf_and_sssa_match_matlab_oracle():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert expected["schema"] == "power-flow-py/matlab-ieee14-switch-oracle/1.0"
    result=solve_case("ibr","ieee14_switch",{"ibr_analysis":"sssa"})
    np.testing.assert_allclose(result.pf_voltage,expected["pf_voltage"],rtol=0,atol=2e-12)
    np.testing.assert_allclose(result.pf_angle_deg,expected["pf_angle_deg"],rtol=0,atol=2e-10)
    oracle=np.asarray(expected["eigen_real"])+1j*np.asarray(expected["eigen_imag"])
    np.testing.assert_allclose(_sorted_eigenvalues(result.eigenvalues),_sorted_eigenvalues(oracle),rtol=0,atol=5e-7)
    assert result.state_matrix.shape == (28,28)
    assert result.summary()["small_signal_unstable_modes"] == 0
    assert result.metadata["initial_equilibrium_residual"] < 1e-10


def test_ieee14_trip_switch_trajectory_matches_matlab_oracle():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"))
    result=solve_case("ibr","ieee14_switch",{"ibr_analysis":"ts","t_end":2.5,"dt":.002})
    sample=np.asarray(expected["sample_indices"][:7],dtype=int)
    np.testing.assert_allclose(result.time[sample],np.asarray(expected["t"])[:7],rtol=0,atol=1e-15)
    np.testing.assert_allclose(_combined_state(result)[sample],np.asarray(expected["Z"])[:7],rtol=0,atol=3e-12)
    for actual,key,tolerance in (
        (result.index[sample],"index",1e-11),(result.mode[sample],"mode",0),
        (result.p_ibr[sample],"P_ibr",3e-12),(result.q_ibr[sample],"Q_ibr",3e-12),
        (result.v_min[sample],"Vmin",1e-12),
    ):
        np.testing.assert_allclose(actual,np.asarray(expected[key])[:7],rtol=0,atol=tolerance)
    np.testing.assert_allclose(result.switch_events,np.asarray(expected["switch_events"])[:4],rtol=0,atol=1e-11)
    assert result.converged and result.final_modes == ("GFM",)*4
    assert result.v_min.min() > .1


def test_ieee14_reclose_handback_transactions_match_matlab():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"))
    result=solve_case("ibr","ieee14_switch",{"ibr_analysis":"ts","t_end":4.002,"dt":.002})
    source=np.asarray(expected["sample_indices"])
    wanted=np.array([1999,2000,2001]);positions=np.array([int(np.flatnonzero(source==i)[0]) for i in wanted])
    np.testing.assert_allclose(_combined_state(result)[wanted],np.asarray(expected["Z"])[positions],rtol=0,atol=4e-12)
    np.testing.assert_allclose(result.switch_events,np.asarray(expected["switch_events"]),rtol=0,atol=1e-11,equal_nan=True)
    assert result.summary()["switch_transactions"] == 12


def test_ieee14_switch_options_fail_closed():
    with pytest.raises(PowerFlowError,match="index_mode"):
        solve_case("ibr","ieee14_switch",{"index_mode":"invented"})
    with pytest.raises(PowerFlowError,match="agsi_down"):
        solve_case("ibr","ieee14_switch",{"agsi_up":.4,"agsi_down":.5})
