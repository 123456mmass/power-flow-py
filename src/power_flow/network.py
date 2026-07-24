"""Network preparation and equation primitives shared by PF analyses."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from power_flow.contracts import ComplexArray, FloatArray, PowerCase, PowerFlowError


IntArray = NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class PowerFlowModel:
    case: PowerCase
    external_bus_ids: IntArray
    bus_type: IntArray
    voltage_spec: FloatArray
    angle_spec_deg: FloatArray
    p_gen: FloatArray
    q_gen: FloatArray
    p_load: FloatArray
    q_load: FloatArray
    g_shunt: FloatArray
    b_shunt: FloatArray
    q_min: FloatArray
    q_max: FloatArray
    p_net: FloatArray
    q_net: FloatArray
    ref: IntArray
    pv: IntArray
    pq: IntArray
    delta_indices: IntArray
    voltage_indices: IntArray
    line_from_indices: IntArray
    line_to_indices: IntArray
    ybus: ComplexArray

    @property
    def num_buses(self) -> int:
        return self.case.bus_data.shape[0]

    @property
    def num_lines(self) -> int:
        return self.case.line_data.shape[0]

    @property
    def num_delta(self) -> int:
        return self.delta_indices.size

    @property
    def num_voltage(self) -> int:
        return self.voltage_indices.size

    @property
    def num_states(self) -> int:
        return self.num_delta + self.num_voltage


def _validate_case(case: PowerCase) -> None:
    bus = case.bus_data
    line = case.line_data
    bus_ids = bus[:, 0]

    if not np.all(np.isfinite(bus_ids)) or not np.all(bus_ids == np.round(bus_ids)):
        raise PowerFlowError("bus_ids", "Bus IDs must be finite integers.")
    if np.unique(bus_ids).size != bus_ids.size:
        raise PowerFlowError("duplicate_bus_ids", "bus_data contains duplicate bus numbers.")

    bus_types = bus[:, 1]
    if np.count_nonzero(bus_types == 1) != 1:
        raise PowerFlowError("ref_count", "Exactly one slack bus is required for this solver.")
    if not np.all(np.isin(bus_types, [1, 2, 3])):
        raise PowerFlowError("bus_type", "Bus types must be 1 (Slack), 2 (PV), or 3 (PQ).")
    if np.any(bus[:, 2] <= 0) or np.any(~np.isfinite(bus[:, 2])):
        raise PowerFlowError(
            "voltage_magnitude",
            "Initial/specified voltage magnitudes must be finite and positive.",
        )
    if np.any(bus[:, 10] > bus[:, 11]):
        raise PowerFlowError(
            "q_limits",
            "Qmin must be less than or equal to Qmax for every bus.",
        )
    if np.any((line[:, 2] == 0) & (line[:, 3] == 0)):
        raise PowerFlowError("zero_impedance", "Each line must have non-zero impedance.")
    if np.any(~np.isfinite(line)):
        raise PowerFlowError("line_nonfinite", "line_data must contain only finite values.")


def build_ybus(
    case: PowerCase,
    line_from_indices: IntArray,
    line_to_indices: IntArray,
) -> ComplexArray:
    ybus = np.zeros((case.bus_data.shape[0], case.bus_data.shape[0]), dtype=np.complex128)
    for row, from_index, to_index in zip(
        case.line_data, line_from_indices, line_to_indices, strict=True
    ):
        resistance, reactance, b_half, tap_ratio, phase_deg = row[2:7]
        tap = tap_ratio * np.exp(1j * np.deg2rad(phase_deg))
        y_series = 1.0 / complex(resistance, reactance)
        y_shunt = 1j * b_half

        ybus[from_index, from_index] += (y_series + y_shunt) / (tap * np.conj(tap))
        ybus[to_index, to_index] += y_series + y_shunt
        ybus[from_index, to_index] -= y_series / np.conj(tap)
        ybus[to_index, from_index] -= y_series / tap

    ybus[np.diag_indices_from(ybus)] += case.bus_data[:, 8] + 1j * case.bus_data[:, 9]
    return ybus


def prepare_case(case: PowerCase) -> PowerFlowModel:
    if not isinstance(case, PowerCase):
        raise PowerFlowError("case_type", "case must be a PowerCase instance.")
    _validate_case(case)

    bus = case.bus_data
    external_bus_ids = bus[:, 0].astype(np.int64)
    id_to_index = {int(bus_id): index for index, bus_id in enumerate(external_bus_ids)}
    try:
        line_from = np.array([id_to_index[int(value)] for value in case.line_data[:, 0]], dtype=np.int64)
        line_to = np.array([id_to_index[int(value)] for value in case.line_data[:, 1]], dtype=np.int64)
    except KeyError as error:
        raise PowerFlowError(
            "line_endpoint",
            "Line data references bus numbers that do not exist in bus_data.",
        ) from error

    bus_type = bus[:, 1].astype(np.int64)
    ref = np.flatnonzero(bus_type == 1).astype(np.int64)
    pv = np.flatnonzero(bus_type == 2).astype(np.int64)
    pq = np.flatnonzero(bus_type == 3).astype(np.int64)
    ybus = build_ybus(case, line_from, line_to)

    return PowerFlowModel(
        case=case,
        external_bus_ids=external_bus_ids,
        bus_type=bus_type,
        voltage_spec=np.array(bus[:, 2], copy=True),
        angle_spec_deg=np.array(bus[:, 3], copy=True),
        p_gen=np.array(bus[:, 4], copy=True),
        q_gen=np.array(bus[:, 5], copy=True),
        p_load=np.array(bus[:, 6], copy=True),
        q_load=np.array(bus[:, 7], copy=True),
        g_shunt=np.array(bus[:, 8], copy=True),
        b_shunt=np.array(bus[:, 9], copy=True),
        q_min=np.array(bus[:, 10], copy=True),
        q_max=np.array(bus[:, 11], copy=True),
        p_net=np.array(bus[:, 4] - bus[:, 6], copy=True),
        q_net=np.array(bus[:, 5] - bus[:, 7], copy=True),
        ref=ref,
        pv=pv,
        pq=pq,
        delta_indices=np.concatenate((pv, pq)),
        voltage_indices=np.array(pq, copy=True),
        line_from_indices=line_from,
        line_to_indices=line_to,
        ybus=ybus,
    )


def initial_state(model: PowerFlowModel) -> FloatArray:
    angles = np.deg2rad(model.angle_spec_deg[model.delta_indices])
    voltages = model.voltage_spec[model.voltage_indices]
    return np.concatenate((angles, voltages)).astype(np.float64)


def state_to_voltage_angle(
    state: FloatArray, model: PowerFlowModel
) -> tuple[FloatArray, FloatArray]:
    state = np.asarray(state, dtype=np.float64)
    if state.shape != (model.num_states,):
        raise PowerFlowError(
            "state_shape",
            f"Expected state shape {(model.num_states,)}; got {state.shape}.",
        )
    angle = np.zeros(model.num_buses, dtype=np.float64)
    voltage = np.zeros(model.num_buses, dtype=np.float64)
    angle[model.ref] = np.deg2rad(model.angle_spec_deg[model.ref])
    voltage[model.ref] = model.voltage_spec[model.ref]
    angle[model.delta_indices] = state[: model.num_delta]
    voltage[model.pv] = model.voltage_spec[model.pv]
    voltage[model.pq] = state[model.num_delta :]
    return angle, voltage


def calculate_power_injections(
    voltage: FloatArray, angle: FloatArray, ybus: ComplexArray
) -> tuple[FloatArray, FloatArray]:
    phasor = voltage * np.exp(1j * angle)
    power = phasor * np.conj(ybus @ phasor)
    return np.asarray(power.real), np.asarray(power.imag)


def calculate_mismatch(
    state: FloatArray,
    model: PowerFlowModel,
    p_spec: FloatArray | None = None,
    q_spec: FloatArray | None = None,
) -> tuple[FloatArray, FloatArray, FloatArray, FloatArray, FloatArray]:
    angle, voltage = state_to_voltage_angle(state, model)
    p_calc, q_calc = calculate_power_injections(voltage, angle, model.ybus)
    scheduled_p = model.p_net if p_spec is None else p_spec
    scheduled_q = model.q_net if q_spec is None else q_spec
    mismatch = np.concatenate(
        (
            scheduled_p[model.delta_indices] - p_calc[model.delta_indices],
            scheduled_q[model.voltage_indices] - q_calc[model.voltage_indices],
        )
    )
    return mismatch, p_calc, q_calc, voltage, angle


def build_jacobian(
    voltage: FloatArray,
    angle: FloatArray,
    p_calc: FloatArray,
    q_calc: FloatArray,
    model: PowerFlowModel,
) -> FloatArray:
    gbus = model.ybus.real
    bbus = model.ybus.imag
    jacobian = np.zeros((model.num_states, model.num_states), dtype=np.float64)

    for i, bus_i in enumerate(model.delta_indices):
        for j, bus_j in enumerate(model.delta_indices):
            delta_ij = angle[bus_i] - angle[bus_j]
            if i == j:
                jacobian[i, j] = -q_calc[bus_i] - bbus[bus_i, bus_i] * voltage[bus_i] ** 2
            else:
                jacobian[i, j] = voltage[bus_i] * voltage[bus_j] * (
                    gbus[bus_i, bus_j] * np.sin(delta_ij)
                    - bbus[bus_i, bus_j] * np.cos(delta_ij)
                )

    for i, bus_i in enumerate(model.delta_indices):
        for j, bus_j in enumerate(model.voltage_indices):
            delta_ij = angle[bus_i] - angle[bus_j]
            column = model.num_delta + j
            if bus_i == bus_j:
                jacobian[i, column] = (
                    p_calc[bus_i] / voltage[bus_i] + gbus[bus_i, bus_i] * voltage[bus_i]
                )
            else:
                jacobian[i, column] = voltage[bus_i] * (
                    gbus[bus_i, bus_j] * np.cos(delta_ij)
                    + bbus[bus_i, bus_j] * np.sin(delta_ij)
                )

    for i, bus_i in enumerate(model.voltage_indices):
        row = model.num_delta + i
        for j, bus_j in enumerate(model.delta_indices):
            delta_ij = angle[bus_i] - angle[bus_j]
            if bus_i == bus_j:
                jacobian[row, j] = p_calc[bus_i] - gbus[bus_i, bus_i] * voltage[bus_i] ** 2
            else:
                jacobian[row, j] = -voltage[bus_i] * voltage[bus_j] * (
                    gbus[bus_i, bus_j] * np.cos(delta_ij)
                    + bbus[bus_i, bus_j] * np.sin(delta_ij)
                )

    for i, bus_i in enumerate(model.voltage_indices):
        row = model.num_delta + i
        for j, bus_j in enumerate(model.voltage_indices):
            delta_ij = angle[bus_i] - angle[bus_j]
            column = model.num_delta + j
            if i == j:
                jacobian[row, column] = (
                    q_calc[bus_i] / voltage[bus_i] - bbus[bus_i, bus_i] * voltage[bus_i]
                )
            else:
                jacobian[row, column] = voltage[bus_i] * (
                    gbus[bus_i, bus_j] * np.sin(delta_ij)
                    - bbus[bus_i, bus_j] * np.cos(delta_ij)
                )
    return jacobian


def calculate_line_flows(
    model: PowerFlowModel, voltage: FloatArray, angle: FloatArray
) -> tuple[FloatArray, FloatArray, FloatArray, FloatArray]:
    p_flow = np.zeros(model.num_lines)
    q_flow = np.zeros(model.num_lines)
    p_loss = np.zeros(model.num_lines)
    q_loss = np.zeros(model.num_lines)
    phasor = voltage * np.exp(1j * angle)

    for index, (row, from_index, to_index) in enumerate(
        zip(model.case.line_data, model.line_from_indices, model.line_to_indices, strict=True)
    ):
        resistance, reactance, b_half, tap_ratio, phase_deg = row[2:7]
        y_series = 1.0 / complex(resistance, reactance)
        y_shunt = 1j * b_half
        tap = tap_ratio * np.exp(1j * np.deg2rad(phase_deg))
        current_from = (
            (y_series + y_shunt) / (tap * np.conj(tap)) * phasor[from_index]
            - y_series / np.conj(tap) * phasor[to_index]
        )
        current_to = (
            (y_series + y_shunt) * phasor[to_index]
            - y_series / tap * phasor[from_index]
        )
        power_from = phasor[from_index] * np.conj(current_from)
        power_to = phasor[to_index] * np.conj(current_to)
        p_flow[index] = power_from.real
        q_flow[index] = power_from.imag
        p_loss[index] = (power_from + power_to).real
        q_loss[index] = (power_from + power_to).imag
    return p_flow, q_flow, p_loss, q_loss
