"""Backward/forward sweep for the deliberately narrow Phase-1 radial contract."""

from __future__ import annotations

from collections import deque

import numpy as np

from power_flow.contracts import PowerCase, PowerFlowError, PowerFlowOptions, PowerFlowResult
from power_flow.network import PowerFlowModel, prepare_case
from power_flow.pf.common import build_result, full_mismatch


def validate_radial_topology(model: PowerFlowModel) -> tuple[np.ndarray, list[list[int]], list[int]]:
    if model.ref.size != 1:
        raise PowerFlowError("bfs_ref_count", "BFS requires exactly one REF bus.")
    if model.pv.size:
        raise PowerFlowError("bfs_pv_unsupported", "Phase-1 BFS supports REF and PQ buses only.")
    if model.num_lines != model.num_buses - 1:
        raise PowerFlowError("bfs_not_radial", "Phase-1 BFS requires a radial tree.")
    edges = [tuple(sorted((int(a), int(b)))) for a, b in zip(model.line_from_indices, model.line_to_indices, strict=True)]
    if len(set(edges)) != len(edges):
        raise PowerFlowError("bfs_parallel_branch", "Phase-1 BFS rejects parallel branches.")
    lines = model.case.line_data
    if np.any(np.abs(lines[:, 5] - 1.0) > 1e-12):
        raise PowerFlowError("bfs_tap_unsupported", "Phase-1 BFS requires unity taps.")
    if np.any(np.abs(lines[:, 6]) > 1e-12):
        raise PowerFlowError("bfs_phase_unsupported", "Phase-1 BFS requires zero phase shifts.")
    if np.any(model.g_shunt != 0) or np.any(model.b_shunt != 0):
        raise PowerFlowError("bfs_shunt_unsupported", "Phase-1 BFS rejects bus shunts.")
    if np.any(lines[:, 4] != 0):
        raise PowerFlowError("bfs_charging_unsupported", "Phase-1 BFS rejects line charging.")
    adjacency: list[list[int]] = [[] for _ in range(model.num_buses)]
    for a, b in zip(model.line_from_indices, model.line_to_indices, strict=True):
        adjacency[int(a)].append(int(b)); adjacency[int(b)].append(int(a))
    root = int(model.ref[0]); parent = np.full(model.num_buses, -1, dtype=np.int64)
    children: list[list[int]] = [[] for _ in range(model.num_buses)]
    order: list[int] = []; queue = deque([root]); parent[root] = root
    while queue:
        current = queue.popleft(); order.append(current)
        for child in adjacency[current]:
            if parent[child] == -1:
                parent[child] = current; children[current].append(child); queue.append(child)
    if len(order) != model.num_buses:
        raise PowerFlowError("bfs_disconnected", "Phase-1 BFS requires a connected network.")
    return parent, children, order


def solve_bfs(case: PowerCase, options: PowerFlowOptions | None = None) -> PowerFlowResult:
    opt = options or PowerFlowOptions(pf_method="bfs", max_iter=100)
    model = prepare_case(case); parent, children, order = validate_radial_topology(model)
    branch_by_edge = {
        tuple(sorted((int(a), int(b)))): i
        for i, (a, b) in enumerate(zip(model.line_from_indices, model.line_to_indices, strict=True))
    }
    phasor = np.ones(model.num_buses, dtype=np.complex128)
    root = order[0]
    phasor[root] = model.voltage_spec[root] * np.exp(1j * np.deg2rad(model.angle_spec_deg[root]))
    history: list[float] = []; converged = False
    reason, finite_status = "max_iterations", "all_finite"
    for _ in range(opt.max_iter):
        injection = np.conj((model.p_net + 1j * model.q_net) / phasor); injection[root] = 0
        downstream = np.zeros(model.num_buses, dtype=np.complex128)
        for bus in reversed(order[1:]):
            downstream[bus] = injection[bus] + sum((downstream[c] for c in children[bus]), 0j)
        updated = np.array(phasor, copy=True)
        for bus in order[1:]:
            edge = branch_by_edge[tuple(sorted((bus, int(parent[bus]))))]
            row = model.case.line_data[edge]
            updated[bus] = updated[parent[bus]] + complex(row[2], row[3]) * downstream[bus]
        phasor = updated
        mismatch = full_mismatch(model, abs(phasor), np.angle(phasor))
        maximum = float(np.max(np.abs(mismatch))) if mismatch.size else 0.0
        history.append(maximum)
        if not np.all(np.isfinite(mismatch)):
            reason, finite_status = "nonfinite_system", "nonfinite_mismatch"; break
        if maximum < opt.tolerance:
            converged, reason = True, "converged"; break
    return build_result(
        model, abs(phasor), np.angle(phasor), history, converged, reason, finite_status, "bfs",
        {"method_variant": "radial-phase1",
         "method_source": "in-house BFS (Shirmohammadi 1988) Phase-1 radial"},
    )
