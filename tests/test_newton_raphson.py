from __future__ import annotations

import numpy as np

from power_flow import BaseValues, PowerCase, PowerFlowOptions
from power_flow.cases import ieee5, ieee14
from power_flow.pf import solve_newton_raphson


def test_ieee5_regression() -> None:
    result = solve_newton_raphson(ieee5())
    assert result.converged
    assert result.reason == "converged"
    assert result.iterations == 4
    assert result.p_loss_total == pytest_approx(0.06147373780504039, 5e-10)
    assert result.max_mismatch < 1e-6


def test_ieee14_regression() -> None:
    result = solve_newton_raphson(ieee14(), PowerFlowOptions(tolerance=1e-10, max_iter=50))
    assert result.converged
    assert result.iterations == 5
    assert result.p_loss_total == pytest_approx(0.13393272357898603, 5e-12)
    expected_voltage = np.array(
        [
            1.06, 1.045, 1.01, 1.01767085, 1.01951386, 1.07, 1.06151953,
            1.09, 1.05593172, 1.05098462, 1.05690652, 1.05518856,
            1.05038171, 1.03552995,
        ]
    )
    np.testing.assert_allclose(result.bus_voltage, expected_voltage, atol=5e-9, rtol=0)


def test_complex_power_and_balance_identities() -> None:
    result = solve_newton_raphson(ieee5(), PowerFlowOptions(tolerance=1e-10))
    phasor = result.bus_voltage * np.exp(1j * result.bus_angle)
    power = phasor * np.conj(result.ybus @ phasor)
    np.testing.assert_allclose(power.real, result.p_injection, atol=1e-12, rtol=0)
    np.testing.assert_allclose(power.imag, result.q_injection, atol=1e-12, rtol=0)
    assert abs(result.p_total_gen - result.p_total_load - result.p_loss_total) < 1e-10
    assert abs(result.q_total_gen - result.q_total_load - result.q_loss_total) < 1e-10


def test_bus_row_permutation_invariance() -> None:
    case = ieee5()
    baseline = solve_newton_raphson(case, PowerFlowOptions(tolerance=1e-10))
    permutation = np.array([3, 0, 4, 1, 2])
    permuted = solve_newton_raphson(
        case.with_bus_data(case.bus_data[permutation]),
        PowerFlowOptions(tolerance=1e-10),
    )
    positions = {bus_id: index for index, bus_id in enumerate(permuted.external_bus_ids)}
    mapped = np.array([positions[bus_id] for bus_id in baseline.external_bus_ids])
    np.testing.assert_allclose(permuted.bus_voltage[mapped], baseline.bus_voltage, atol=1e-10, rtol=0)
    np.testing.assert_allclose(permuted.p_generation[mapped], baseline.p_generation, atol=1e-10, rtol=0)


def test_max_iterations_is_structured_failure() -> None:
    result = solve_newton_raphson(ieee5(), PowerFlowOptions(max_iter=1))
    assert not result.converged
    assert result.reason == "max_iterations"
    assert result.finite_status == "all_finite"
    assert result.iterations == 1


def test_singular_jacobian_is_structured_failure() -> None:
    case = PowerCase(
        "islanded",
        BaseValues(100, 1, 60),
        [
            [1, 1, 1.0, 0, 0, 0, 0, 0, 0, 0, -np.inf, np.inf],
            [2, 3, 1.0, 0, 0, 0, 1, 0.5, 0, 0, -np.inf, np.inf],
        ],
        [[1, 1, 0.001, 0.01, 0, 1, 0]],
    )
    result = solve_newton_raphson(case, PowerFlowOptions(enforce_q_limits=False))
    assert not result.converged
    assert result.reason == "singular_jacobian"
    assert result.finite_status.startswith("rcond_")


def test_q_limit_switches_pv_to_pq() -> None:
    case = ieee5()
    bus_data = np.array(case.bus_data, copy=True)
    bus_data[1, 10] = 0.0
    bus_data[1, 11] = 1.0
    result = solve_newton_raphson(
        case.with_bus_data(bus_data), PowerFlowOptions(tolerance=1e-10)
    )
    assert result.converged
    assert result.q_limit_rounds == 1
    assert len(result.q_limit_events) == 1
    assert result.q_limit_events[0].bus_id == 2
    assert result.q_limit_events[0].limit_type == "Qmin"
    assert result.q_generation[1] == pytest_approx(0.0, 1e-8)


def pytest_approx(expected: float, tolerance: float):
    import pytest

    return pytest.approx(expected, abs=tolerance, rel=0)
