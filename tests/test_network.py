from __future__ import annotations

import numpy as np
import pytest

from power_flow import BaseValues, PowerCase, PowerFlowError
from power_flow.cases import ieee14
from power_flow.network import (
    build_jacobian,
    calculate_mismatch,
    initial_state,
    prepare_case,
)


def two_bus(*, tap: float = 1.0, phase_deg: float = 0.0) -> PowerCase:
    return PowerCase(
        "two-bus analytic",
        BaseValues(100, 1, 60),
        [
            [1, 1, 1.0, 0, 0, 0, 0, 0, 0, 0, -np.inf, np.inf],
            [2, 3, 1.0, 0, 0, 0, 1.0, 0.5, 0, 0, -np.inf, np.inf],
        ],
        [[1, 2, 0.01, 0.1, 0, tap, phase_deg]],
    )


def test_ybus_two_bus_analytic() -> None:
    model = prepare_case(two_bus())
    series = 1 / (0.01 + 0.1j)
    expected = np.array([[series, -series], [-series, series]])
    np.testing.assert_allclose(model.ybus, expected, atol=1e-12, rtol=0)


def test_ybus_tap_and_phase_contract() -> None:
    tap_ratio = 0.9
    phase = 5.0
    model = prepare_case(two_bus(tap=tap_ratio, phase_deg=phase))
    series = 1 / (0.01 + 0.1j)
    tap = tap_ratio * np.exp(1j * np.deg2rad(phase))
    assert model.ybus[0, 0] == pytest.approx(series / (tap * np.conj(tap)), abs=1e-12)
    assert model.ybus[0, 1] == pytest.approx(-series / np.conj(tap), abs=1e-12)
    assert model.ybus[1, 0] == pytest.approx(-series / tap, abs=1e-12)


def test_analytic_jacobian_matches_central_difference() -> None:
    model = prepare_case(ieee14())
    state = initial_state(model)
    _, p_calc, q_calc, voltage, angle = calculate_mismatch(state, model)
    analytic = build_jacobian(voltage, angle, p_calc, q_calc, model)
    h = 1e-5
    finite_difference = np.zeros_like(analytic)
    for column in range(state.size):
        plus = state.copy()
        minus = state.copy()
        plus[column] += h
        minus[column] -= h
        mismatch_plus = calculate_mismatch(plus, model)[0]
        mismatch_minus = calculate_mismatch(minus, model)[0]
        finite_difference[:, column] = -(mismatch_plus - mismatch_minus) / (2 * h)
    np.testing.assert_allclose(analytic, finite_difference, atol=1e-6, rtol=0)


def test_invalid_endpoint_and_duplicate_id_fail_closed() -> None:
    bad_line = PowerCase(
        "bad line",
        BaseValues(),
        two_bus().bus_data,
        [[1, 99, 0.01, 0.1]],
    )
    with pytest.raises(PowerFlowError) as endpoint:
        prepare_case(bad_line)
    assert endpoint.value.code == "line_endpoint"

    duplicate = np.array(two_bus().bus_data, copy=True)
    duplicate[1, 0] = 1
    with pytest.raises(PowerFlowError) as duplicate_error:
        prepare_case(two_bus().with_bus_data(duplicate))
    assert duplicate_error.value.code == "duplicate_bus_ids"
