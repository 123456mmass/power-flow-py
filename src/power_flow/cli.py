"""Command-line interface for the headless solver."""

from __future__ import annotations

import argparse
import json
import sys

from power_flow.api import solve_case
from power_flow.contracts import PowerFlowError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Project-owned AC power-flow solver")
    parser.add_argument("--analysis", default="pf", help="Analysis ID (currently: pf)")
    parser.add_argument("--case", default="ieee5", help="Case ID (ieee5 or ieee14)")
    parser.add_argument("--tolerance", type=float, default=1e-6)
    parser.add_argument("--max-iter", type=int, default=20)
    parser.add_argument("--no-q-limits", action="store_true")
    parser.add_argument("--indent", type=int, default=2)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = solve_case(
            args.analysis,
            args.case,
            {
                "tolerance": args.tolerance,
                "max_iter": args.max_iter,
                "enforce_q_limits": not args.no_q_limits,
            },
        )
    except PowerFlowError as error:
        print(json.dumps({"error": error.code, "message": str(error)}), file=sys.stderr)
        return 2
    print(json.dumps(result.summary(), indent=args.indent, allow_nan=False))
    return 0 if result.converged else 1


if __name__ == "__main__":
    raise SystemExit(main())
