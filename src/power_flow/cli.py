"""Command-line interface for the headless solver."""

from __future__ import annotations

import argparse
import json
import sys

from power_flow.api import solve_case
from power_flow.contracts import PowerFlowError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Project-owned power-system analysis")
    parser.add_argument("--analysis", default="pf", choices=("pf", "sssa", "ts", "ibr"))
    parser.add_argument("--case", default="ieee5", help="Active network case ID")
    parser.add_argument("--tolerance", type=float, default=1e-6)
    parser.add_argument("--max-iter", type=int)
    parser.add_argument(
        "--method", default="newton_raphson",
        choices=("newton_raphson", "gauss_seidel", "fdpf_xb", "fdpf_bx", "bfs"),
    )
    parser.add_argument("--acceleration", type=float, default=1.4)
    parser.add_argument("--no-q-limits", action="store_true")
    parser.add_argument("--model", choices=("classical", "emf6", "padiyar_1_1_avr", "padiyar_1_1_manual"))
    parser.add_argument("--t-end", type=float, default=1.0)
    parser.add_argument("--dt", type=float, default=0.01)
    parser.add_argument("--fault-bus", type=int)
    parser.add_argument("--ibr-product", default="full", choices=("pf", "sssa", "ts", "full"))
    parser.add_argument("--ibr-fault-on", type=float, default=0.0)
    parser.add_argument("--ibr-fault-clear", type=float, default=0.0)
    parser.add_argument("--ibr-fault-reactance", type=float, default=0.10)
    parser.add_argument("--ibr-step-on", type=float, default=0.0)
    parser.add_argument("--ibr-step-dv", type=float, default=-0.10)
    parser.add_argument("--ibr-step-dphase-deg", type=float, default=20.0)
    parser.add_argument("--t-fault", type=float, default=0.5)
    parser.add_argument("--t-clear", type=float, default=0.6)
    parser.add_argument(
        "--integrator", default="trapezoidal",
        choices=("trapezoidal", "rk4", "backward_euler"),
    )
    parser.add_argument("--indent", type=int, default=2)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.analysis == "pf":
            options = {
                "tolerance": args.tolerance,
                "enforce_q_limits": not args.no_q_limits,
                "pf_method": args.method,
                "acceleration": args.acceleration,
            }
            if args.max_iter is not None:
                options["max_iter"] = args.max_iter
        elif args.analysis == "sssa":
            options = {}
            if args.model is not None:
                options["model"] = args.model
        elif args.analysis == "ts":
            options = {
                "t_end": args.t_end, "dt": args.dt, "fault_bus": args.fault_bus,
                "t_fault": args.t_fault,
                "t_clear": args.t_clear, "integrator": args.integrator,
            }
            if args.model is not None:
                options["model"] = args.model
        else:
            options = {
                "ibr_analysis": args.ibr_product, "t_end": args.t_end, "dt": args.dt,
                "fault_on": args.ibr_fault_on, "fault_clear": args.ibr_fault_clear,
                "fault_impedance": 1j * args.ibr_fault_reactance,
                "step_on": args.ibr_step_on, "step_dv": args.ibr_step_dv,
                "step_dphase_deg": args.ibr_step_dphase_deg,
            }
        result = solve_case(
            args.analysis,
            args.case,
            options,
        )
    except PowerFlowError as error:
        print(json.dumps({"error": error.code, "message": str(error)}), file=sys.stderr)
        return 2
    print(json.dumps(result.summary(), indent=args.indent, allow_nan=False))
    return 0 if not hasattr(result, "converged") or result.converged else 1


if __name__ == "__main__":
    raise SystemExit(main())
