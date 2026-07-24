"""Load audited static inputs for every active MATLAB network catalog case."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from power_flow.contracts import BaseValues, PowerCase, PowerFlowError


CATALOG_SCHEMA = "power-flow-py/network-catalog/1.0"
CATALOG_FILE = Path(__file__).with_name("data") / "network_catalog.json"


@lru_cache(maxsize=1)
def _catalog() -> tuple[dict[str, dict[str, Any]], str]:
    payload = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    if payload.get("schema") != CATALOG_SCHEMA:
        raise PowerFlowError("catalog_schema", "The bundled network catalog schema is invalid.")
    entries = {str(item["id"]): item for item in payload["cases"]}
    if len(entries) != len(payload["cases"]):
        raise PowerFlowError("catalog_duplicate", "The bundled network catalog has duplicate IDs.")
    return entries, str(payload["source_git_commit"])


def catalog_ids() -> tuple[str, ...]:
    return tuple(_catalog()[0])


def load_catalog_case(case_id: str) -> PowerCase:
    entries, source_commit = _catalog()
    try:
        item = entries[case_id]
    except KeyError as error:
        raise PowerFlowError("unknown_case", f"Unknown catalog case {case_id!r}.") from error

    raw_bus = item["bus_data"]
    bus = np.empty((len(raw_bus), 12), dtype=np.float64)
    for row_index, row in enumerate(raw_bus):
        if len(row) != 12:
            raise PowerFlowError("catalog_bus_columns", f"Case {case_id} has a malformed bus row.")
        for column, value in enumerate(row):
            if value is None and column == 10:
                bus[row_index, column] = -np.inf
            elif value is None and column == 11:
                bus[row_index, column] = np.inf
            elif value is None:
                raise PowerFlowError(
                    "catalog_nonfinite", f"Case {case_id} has null outside a Q-limit column."
                )
            else:
                bus[row_index, column] = float(value)

    base = item["base_values"]
    return PowerCase(
        system_name=str(item["system_name"]),
        base_values=BaseValues(
            float(base["S_base_MVA"]),
            float(base["V_base_kV"]),
            float(base["frequency_Hz"]),
        ),
        bus_data=bus,
        line_data=item["line_data"],
        reference={
            "source_loader": item["source_loader"],
            "source_git_commit": source_commit,
            "port_kind": "static network input snapshot",
        },
        dynamic_data={"machines": item.get("machines", {})},
    )
