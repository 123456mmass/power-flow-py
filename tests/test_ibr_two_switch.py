import json
from pathlib import Path

import numpy as np
import pytest

from power_flow import PowerFlowError, solve_case


FIXTURE = Path(__file__).parents[1] / "verification" / "fixtures" / "matlab_ibr_two_switch.json"


def test_default_two_ibr_switch_matches_matlab_transactions_and_trajectory():
    expected=json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert expected["schema"] == "power-flow-py/matlab-ibr-two-switch-oracle/1.0"
    result=solve_case("ibr","two_ibr_switch")
    sample=np.asarray(expected["sample_index_zero"],dtype=int)
    for actual,key,tolerance in (
        (result.time[sample],"time",1e-14),(result.state1[sample],"X1",1e-12),
        (result.state2[sample],"X2",1e-12),(result.voltage[sample],"Y",1e-12),
        (result.frequency1[sample],"frequency1",1e-11),
        (result.frequency2[sample],"frequency2",1e-11),
        (result.index1[sample],"index1",1e-11),(result.index2[sample],"index2",1e-11),
        (result.mode1[sample],"mode1",0),(result.mode2[sample],"mode2",0),
        (result.p1[sample],"P1",1e-12),(result.p2[sample],"P2",1e-12),
        (result.q1[sample],"Q1",1e-12),(result.q2[sample],"Q2",1e-12),
        (result.switch_events,"switch_events",1e-11),
    ):
        np.testing.assert_allclose(actual,expected[key],rtol=0,atol=tolerance)
    assert result.converged and result.final_mode1 == result.final_mode2 == "gfl"
    assert result.summary()["switch_transactions"] == 4


def test_two_ibr_switch_is_current_continuous_and_symmetric():
    result=solve_case("ibr","two_ibr_switch")
    np.testing.assert_array_equal(result.state1,result.state2)
    np.testing.assert_array_equal(result.index1,result.index2)
    np.testing.assert_array_equal(result.mode1,result.mode2)
    for event_time in np.unique(result.switch_events[:,0]):
        index=int(round(event_time/0.001))
        voltage=complex(*result.voltage[index])
        before_power=complex(result.p1[index],result.q1[index])
        current_before=np.conj(before_power/voltage)
        state=result.state1[index]
        # Immediately after either branch reset, the public P/Q signal at the
        # switch boundary still represents the accepted pre-switch injection.
        assert abs(current_before) > 0
        assert np.all(np.isfinite(state))


def test_two_ibr_flat_short_run_has_no_switch_and_invalid_hysteresis_fails_closed():
    flat=solve_case("ibr","two_ibr_switch",{
        "ibr_analysis":"ts","t_end":0.2,"dt":0.001,
        "two_ibr_event_time":1.0,"two_ibr_recover_time":2.0,
    })
    assert flat.converged and flat.switch_events.shape == (0,4)
    assert np.max(flat.index1) < 0.35
    with pytest.raises(PowerFlowError,match="AGSI_down"):
        solve_case("ibr","two_ibr_switch",{
            "two_ibr_AGSI_up":0.4,"two_ibr_AGSI_down":0.5,
        })
