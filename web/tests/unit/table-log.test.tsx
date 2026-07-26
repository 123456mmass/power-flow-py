import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LogConsole } from "@/components/runs/log-console";
import { DataTable, type Column } from "@/components/ui/table";
import type { LogRecord } from "@/lib/domain/types";

interface Bus {
  busId: number;
  name: string;
  vMagPu: number;
}

const rows: Bus[] = [
  { busId: 1, name: "Slack north", vMagPu: 1.06 },
  { busId: 2, name: "Generator east", vMagPu: 1.045 },
  { busId: 3, name: "Load south", vMagPu: 0.982 },
];

const columns: Column<Bus>[] = [
  { id: "bus", header: "Bus", accessor: (row) => row.busId, align: "right" },
  { id: "name", header: "Name", accessor: (row) => row.name },
  { id: "v", header: "V", unit: "pu", accessor: (row) => row.vMagPu, align: "right" },
];

describe("DataTable", () => {
  it("filters rows by the visible columns", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => String(row.busId)} csvName="buses" />);

    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
    await user.type(screen.getByRole("searchbox", { name: /filter rows/i }), "south");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Load south")).toBeDefined();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => String(row.busId)} />);
    await user.type(screen.getByRole("searchbox", { name: /filter rows/i }), "zzz");
    expect(screen.getByText(/no rows match/i)).toBeDefined();
  });

  it("sorts ascending then descending and exposes aria-sort", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => String(row.busId)} />);
    const header = screen.getByRole("button", { name: /^V/ });

    await user.click(header);
    let cells = screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
    expect(cells[0]).toContain("0.982");
    expect(screen.getByRole("columnheader", { name: /V/ }).getAttribute("aria-sort")).toBe("ascending");

    await user.click(header);
    cells = screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
    expect(cells[0]).toContain("1.06");
    expect(screen.getByRole("columnheader", { name: /V/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("hides a column through the column selector", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => String(row.busId)} />);
    await user.click(screen.getByRole("button", { name: /choose columns/i }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Name" }));
    expect(screen.queryByText("Load south")).toBeNull();
  });
});

function log(seq: number, level: LogRecord["level"], message: string, source = "solver"): LogRecord {
  return { seq, at: new Date(2026, 0, 1, 12, 0, seq).toISOString(), level, source, message };
}

const logs: LogRecord[] = [
  log(1, "info", "Loaded case 'ieee14'", "loader"),
  log(2, "debug", "iter 1: max mismatch 2.4e-01 pu"),
  log(3, "warn", "PV→PQ switch on bus 8", "qlimits"),
  log(4, "error", "Iteration limit reached"),
];

describe("LogConsole", () => {
  it("filters by severity", async () => {
    const user = userEvent.setup();
    render(<LogConsole logs={logs} runId="run-0001" />);
    expect(screen.getByText(/iter 1: max mismatch/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "debug", pressed: true }));
    expect(screen.queryByText(/iter 1: max mismatch/)).toBeNull();
    expect(screen.getByText(/PV→PQ switch on bus 8/)).toBeDefined();
  });

  it("searches message text and source", async () => {
    const user = userEvent.setup();
    render(<LogConsole logs={logs} runId="run-0001" />);
    await user.type(screen.getByRole("searchbox", { name: /search log/i }), "qlimits");
    expect(screen.getByText(/PV→PQ switch on bus 8/)).toBeDefined();
    expect(screen.queryByText(/Loaded case/)).toBeNull();
  });

  it("toggles autoscroll", async () => {
    const user = userEvent.setup();
    render(<LogConsole logs={logs} runId="run-0001" />);
    const pause = screen.getByRole("button", { name: /pause scroll/i });
    await user.click(pause);
    expect(screen.getByRole("button", { name: /resume/i })).toBeDefined();
  });

  it("reports an empty state when no records have arrived", () => {
    render(<LogConsole logs={[]} runId="run-0001" />);
    expect(screen.getByText(/waiting for the first log record/i)).toBeDefined();
  });
});
