from __future__ import annotations

import ast
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {
    "matpower",
    "pandapower",
    "pypower",
    "pypsa",
    "gridcal",
    "psat",
    "pgaz",
}
FORBIDDEN_SCIPY_CALLS = {
    "scipy.optimize.root",
    "scipy.optimize.minimize",
    "scipy.optimize.least_squares",
    "scipy.integrate.solve_ivp",
}


def test_declared_dependencies_are_general_primitives_only() -> None:
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    dependencies = data["project"]["dependencies"]
    names = {item.split("<")[0].split(">")[0].split("=")[0].lower() for item in dependencies}
    assert names == {"numpy", "scipy"}


def test_production_imports_do_not_use_forbidden_solvers() -> None:
    for path in (ROOT / "src").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        aliases: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    aliases[alias.asname or alias.name] = alias.name
                    assert alias.name.split(".")[0].lower() not in FORBIDDEN
            elif isinstance(node, ast.ImportFrom) and node.module:
                assert node.module.split(".")[0].lower() not in FORBIDDEN
                for alias in node.names:
                    aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = _qualified_name(node.func, aliases)
            assert name not in FORBIDDEN_SCIPY_CALLS, f"Forbidden production call {name} in {path}"


def _qualified_name(node: ast.expr, aliases: dict[str, str]) -> str:
    if isinstance(node, ast.Name):
        return aliases.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        parent = _qualified_name(node.value, aliases)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""
