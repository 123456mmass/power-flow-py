"""Explicit active case registry."""

from __future__ import annotations

from collections.abc import Callable
from functools import partial

from power_flow.cases.catalog import catalog_ids, load_catalog_case
from power_flow.cases.ieee import ieee5, ieee14
from power_flow.contracts import PowerCase, PowerFlowError


CASE_REGISTRY: dict[str, Callable[[], PowerCase]] = {
    "ieee5": ieee5,
    "ieee14": ieee14,
}
for _case_id in catalog_ids():
    if _case_id not in CASE_REGISTRY:
        CASE_REGISTRY[_case_id] = partial(load_catalog_case, _case_id)


def load_case(case_id: str) -> PowerCase:
    normalized = case_id.strip().lower()
    try:
        loader = CASE_REGISTRY[normalized]
    except KeyError as error:
        allowed = ", ".join(sorted(CASE_REGISTRY))
        raise PowerFlowError("unknown_case", f"Unknown case {case_id!r}; available: {allowed}.") from error
    return loader()


__all__ = ["CASE_REGISTRY", "catalog_ids", "ieee5", "ieee14", "load_case"]
