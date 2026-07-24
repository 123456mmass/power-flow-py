from __future__ import annotations

import numpy as np
import pytest

from power_flow import BaseValues, PowerCase, PowerFlowError, PowerFlowOptions, solve_case
from power_flow.cases import ieee5, ieee14
from power_flow.pf import solve_bfs, solve_fdpf_bx, solve_fdpf_xb, solve_gauss_seidel, solve_newton_raphson


TIGHT = PowerFlowOptions(max_iter=200, tolerance=1e-10, enforce_q_limits=False)


def radial_case() -> PowerCase:
    return PowerCase(
        "three_bus_radial", BaseValues(100, 230, 60),
        [[1, 1, 1.06, 0, 0, 0, 0, 0, 0, 0, 0, 0],
         [2, 3, 1.00, 0, 0, 0, 0.3, 0.1, 0, 0, 0, 0],
         [3, 3, 1.00, 0, 0, 0, 0.4, 0.15, 0, 0, 0, 0]],
        [[1, 2, 0.01, 0.1, 0, 1, 0], [2, 3, 0.02, 0.15, 0, 1, 0]],
    )


@pytest.mark.parametrize("solver", [solve_gauss_seidel, solve_fdpf_xb, solve_fdpf_bx])
def test_meshed_methods_agree_with_newton_raphson(solver) -> None:
    reference = solve_newton_raphson(ieee5(), TIGHT)
    result = solver(ieee5(), TIGHT)
    assert result.converged
    np.testing.assert_allclose(result.bus_voltage, reference.bus_voltage, atol=1e-8, rtol=0)
    np.testing.assert_allclose(result.bus_angle_deg, reference.bus_angle_deg, atol=1e-7, rtol=0)
    assert result.metadata["fallback_used"] is False


def test_fdpf_xb_converges_on_ieee14() -> None:
    result = solve_fdpf_xb(ieee14(), TIGHT)
    assert result.converged
    assert result.metadata["method_variant"] == "XB"


def test_bfs_agrees_with_newton_raphson() -> None:
    case = radial_case()
    bfs = solve_bfs(case, TIGHT)
    nr = solve_newton_raphson(case, TIGHT)
    assert bfs.converged
    np.testing.assert_allclose(bfs.bus_voltage, nr.bus_voltage, atol=1e-8, rtol=0)
    np.testing.assert_allclose(bfs.bus_angle_deg, nr.bus_angle_deg, atol=1e-7, rtol=0)


def test_bfs_fails_closed_outside_capability() -> None:
    with pytest.raises(PowerFlowError) as caught:
        solve_bfs(ieee14(), TIGHT)
    assert caught.value.code == "bfs_pv_unsupported"


@pytest.mark.parametrize("method", ["newton_raphson", "gauss_seidel", "fdpf_xb", "fdpf_bx"])
def test_public_method_routing(method: str) -> None:
    result = solve_case("pf", "ieee5", {"pf_method": method, "max_iter": 200, "tolerance": 1e-8,
                                             "enforce_q_limits": False})
    assert result.converged


def test_unknown_method_fails_closed() -> None:
    with pytest.raises(PowerFlowError) as caught:
        solve_case("pf", "ieee5", {"pf_method": "bogus"})
    assert caught.value.code == "unknown_pf_method"


@pytest.mark.parametrize("solver", [solve_gauss_seidel, solve_fdpf_xb, solve_fdpf_bx])
def test_iterative_methods_share_q_limit_switching(solver) -> None:
    case = ieee5()
    buses = np.array(case.bus_data, copy=True)
    buses[1, 10:12] = [0.0, 1.0]
    result = solver(
        case.with_bus_data(buses),
        PowerFlowOptions(max_iter=200, tolerance=1e-10, enforce_q_limits=True),
    )
    assert result.converged
    assert result.q_limit_rounds == 1
    assert result.q_limit_events[0].bus_id == 2
    assert result.q_limit_events[0].limit_type == "Qmin"
    assert abs(result.q_generation[1]) < 1e-8
