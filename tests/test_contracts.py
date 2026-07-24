from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from power_flow import BaseValues, PowerCase, PowerFlowError


def test_case_standardizes_legacy_widths_and_is_immutable() -> None:
    case = PowerCase(
        "two bus",
        BaseValues(),
        [[1, 1, 1.0, 0, 0, 0, 0, 0], [2, 3, 1.0, 0, 0, 0, 1.0, 0.5]],
        [[1, 2, 0.01, 0.1]],
    )
    assert case.schema_version == "power_case/1.0"
    assert case.bus_data.shape == (2, 12)
    assert case.line_data.shape == (1, 7)
    assert np.isneginf(case.bus_data[:, 10]).all()
    assert np.isposinf(case.bus_data[:, 11]).all()
    assert case.line_data[0, 5] == 1.0
    with pytest.raises(ValueError):
        case.bus_data[0, 0] = 99


def test_unknown_column_count_fails_closed() -> None:
    with pytest.raises(PowerFlowError, match="8, 10, or 12") as caught:
        PowerCase("bad", BaseValues(), np.ones((2, 9)), np.ones((1, 7)))
    assert caught.value.code == "bus_columns"


def test_reference_data_is_not_physical_input() -> None:
    from power_flow.cases import ieee14
    from power_flow.pf import solve_newton_raphson

    case = ieee14()
    baseline = solve_newton_raphson(case)
    corrupted = solve_newton_raphson(replace(case, reference={"bus_voltage": [999.0]}))
    np.testing.assert_allclose(corrupted.bus_voltage, baseline.bus_voltage, atol=0, rtol=0)
    np.testing.assert_allclose(corrupted.bus_angle, baseline.bus_angle, atol=0, rtol=0)
