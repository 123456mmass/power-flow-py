import json
from pathlib import Path

import numpy as np
import pytest

from power_flow import PowerFlowError, solve_case


FIXTURE=Path(__file__).parents[1]/"verification"/"fixtures"/"matlab_padiyar_switch.json"


def _sorted(values):
    values=np.asarray(values,dtype=complex)
    return values[np.lexsort((values.imag,values.real))]


def _combined(result):
    y=np.empty((result.time.size,20));y[:,0::2]=result.bus_voltage.real;y[:,1::2]=result.bus_voltage.imag
    return np.column_stack((result.state,y))


def test_padiyar_switch_pf_sssa_matches_matlab_oracle():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert expected["schema"]=="power-flow-py/matlab-padiyar-switch-oracle/1.0"
    result=solve_case("ibr","padiyar_switch",{"ibr_analysis":"sssa"})
    np.testing.assert_allclose(result.pf_voltage,expected["pf_voltage"],rtol=0,atol=2e-12)
    np.testing.assert_allclose(result.pf_angle_deg,expected["pf_angle_deg"],rtol=0,atol=2e-10)
    oracle=np.asarray(expected["eigen_real"])+1j*np.asarray(expected["eigen_imag"])
    # The rotational reference root is ~1e-6-sensitive to independent FD
    # Jacobians; all physical modes agree much more tightly.
    np.testing.assert_allclose(_sorted(result.eigenvalues),_sorted(oracle),rtol=0,atol=1.2e-6)
    assert result.state_matrix.shape==(23,23)
    assert result.summary()["small_signal_unstable_modes"]==1
    assert result.metadata["initial_equilibrium_residual"]<1e-10


def test_padiyar_trip_trajectory_matches_matlab_oracle():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"));sample=np.asarray(expected["sample_indices"][:7])
    result=solve_case("ibr","padiyar_switch",{"ibr_analysis":"ts","t_end":2.5,"dt":.002})
    np.testing.assert_allclose(_combined(result)[sample],np.asarray(expected["Z"])[:7],rtol=0,atol=3e-12)
    for actual,key,tol in ((result.index[sample],"index",2e-11),(result.mode[sample],"mode",0),
                           (result.p_ibr[sample],"P_ibr",3e-12),(result.q_ibr[sample],"Q_ibr",3e-12),
                           (result.v_min[sample],"Vmin",2e-12)):
        np.testing.assert_allclose(actual,np.asarray(expected[key])[:7],rtol=0,atol=tol)
    np.testing.assert_allclose(result.switch_events,np.asarray(expected["switch_events"])[:3],rtol=0,atol=2e-11)
    assert result.converged and result.final_modes==("GFM",)*3


def test_padiyar_reclose_handback_matches_matlab_transactions():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"));source=np.asarray(expected["sample_indices"])
    result=solve_case("ibr","padiyar_switch",{"ibr_analysis":"ts","t_end":4.002,"dt":.002})
    wanted=np.array([1999,2000,2001]);positions=np.array([int(np.flatnonzero(source==i)[0]) for i in wanted])
    np.testing.assert_allclose(_combined(result)[wanted],np.asarray(expected["Z"])[positions],rtol=0,atol=5e-12)
    np.testing.assert_allclose(result.switch_events,np.asarray(expected["switch_events"]),rtol=0,atol=2e-11,equal_nan=True)
    assert result.final_modes==("gfl","gfl","GFM")


def test_padiyar_switch_options_fail_closed():
    with pytest.raises(PowerFlowError,match="index_mode"):
        solve_case("ibr","padiyar_switch",{"index_mode":"invented"})
    with pytest.raises(PowerFlowError,match="agsi_down"):
        solve_case("ibr","padiyar_switch",{"agsi_up":.4,"agsi_down":.5})
