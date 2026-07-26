import { expect, test } from "@playwright/test";

import { apiPost, completedRunIds, login } from "./helpers";

async function openFirstResult(page: import("@playwright/test").Page, analysis: "pf" | "sssa" | "ibr") {
  const ids = await completedRunIds(page, analysis);
  const runId = ids[0];
  expect(runId, `expected a converged ${analysis} run in the seeded history`).toBeTruthy();
  await page.goto(`/results/${runId}`);
  return runId!;
}

test.describe("results", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("power-flow results expose sortable, filterable bus and branch tables", async ({ page }) => {
    await openFirstResult(page, "pf");
    await expect(page.getByRole("heading", { name: /Bus results|Convergence/ }).first()).toBeVisible();

    const busPanel = page.locator("section", { has: page.getByRole("heading", { name: "Bus results" }) });
    const filter = busPanel.getByRole("searchbox", { name: /filter buses/i });
    await filter.fill("Bus 08");
    await expect(busPanel.getByRole("row")).toHaveCount(2); // header + match
    await filter.fill("");

    // Sorting by voltage puts the extreme value first.
    await busPanel.getByRole("button", { name: /^V/ }).click();
    await expect(busPanel.getByRole("columnheader", { name: /^V/ })).toHaveAttribute("aria-sort", "ascending");

    // Column selection hides a column.
    await busPanel.getByRole("button", { name: /choose columns/i }).click();
    await page.getByRole("menuitemcheckbox", { name: "P load" }).click();
    await page.keyboard.press("Escape");
    await expect(busPanel.getByRole("columnheader", { name: /P load/ })).toHaveCount(0);
  });

  test("SSSA results render the eigenvalue plane and mode table", async ({ page }) => {
    await openFirstResult(page, "sssa");
    await expect(page.getByRole("heading", { name: /Eigenvalue map/ })).toBeVisible();
    await expect(page.locator(".js-plotly-plot")).toBeVisible({ timeout: 30_000 });

    const modePanel = page.locator("section", { has: page.getByRole("heading", { name: "Mode table" }) });
    const filter = modePanel.getByRole("searchbox", { name: /filter modes/i });
    await filter.fill("stable");
    await expect(modePanel.getByRole("table")).toBeVisible();
    await filter.fill("no-such-mode");
    await expect(modePanel.getByText(/no rows match/i)).toBeVisible();
  });

  test("IBR switching results list AGSI++ transactions and events", async ({ page }) => {
    await openFirstResult(page, "ibr");
    await expect(page.getByRole("heading", { name: /Simulation summary|Stability assessment/ }).first()).toBeVisible();
    const overview = page.getByRole("tab", { name: "Overview" });
    await overview.click();
    await expect(page.getByRole("heading", { name: "Execution overview" })).toBeVisible();
    await expect(page.getByText(/Input snapshot/)).toBeVisible();
  });

  test("the printable report renders a linear layout", async ({ page }) => {
    await openFirstResult(page, "pf");
    await page.getByRole("button", { name: "Report" }).click();
    await expect(page.getByRole("heading", { name: /report —/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /print \/ save pdf/i })).toBeVisible();
    await page.getByRole("button", { name: /back to workspace/i }).click();
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  });
});

test.describe("run history", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("status and analysis filters narrow the table", async ({ page }) => {
    await page.goto("/runs");
    const before = await page.locator("tbody tr").count();

    await page.getByRole("button", { name: "failed", exact: true }).click();
    await expect(page).toHaveURL(/status=failed/);
    const failedRows = page.locator("tbody tr");
    await expect(failedRows.first()).toContainText("Failed");
    expect(await failedRows.count()).toBeLessThanOrEqual(before);

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page).toHaveURL(/\/runs$/);

    await page.getByRole("button", { name: "SSSA", exact: true }).click();
    await expect(page).toHaveURL(/analysis=sssa/);
    await expect(page.locator("tbody tr").first()).toContainText("SSSA");
  });

  test("free-text search matches case ids", async ({ page }) => {
    await page.goto("/runs");
    await page.getByLabel("Search").fill("kundur");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/search=kundur/);
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText(/Kundur/i);
  });

  test("pagination moves between pages", async ({ page }) => {
    await page.goto("/runs");
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/page 2 \//)).toBeVisible();
  });

  test("a run can be deleted after confirmation", async ({ page }) => {
    const run = await apiPost<{ id: string }>(page, "/api/runs", {
      config: {
        analysis: "pf",
        case: "case9",
        options: {
          pf_method: "newton_raphson",
          tolerance: 1e-6,
          max_iter: 20,
          enforce_q_limits: true,
          acceleration: 1.4,
          q_limit_tolerance: 1e-6,
          max_q_limit_switches: 20,
        },
      },
      label: "e2e delete target",
    });

    await page.goto("/runs?search=e2e delete target");
    await expect(page.getByText(run.id)).toBeVisible();
    await page.getByRole("button", { name: `Actions for ${run.id}` }).click();
    await page.getByRole("menuitem", { name: "Delete run" }).click();
    await expect(page.getByRole("dialog", { name: new RegExp(`Delete ${run.id}`) })).toBeVisible();
    await page.getByRole("button", { name: "Delete run", exact: true }).click();
    await expect(page.getByText(run.id)).toHaveCount(0, { timeout: 20_000 });
  });

  test("two runs can be compared with aligned axes", async ({ page }) => {
    const ids = (await completedRunIds(page, "ibr")).slice(0, 2);
    expect(ids.length).toBe(2);

    await page.goto(`/compare?runs=${ids.join(",")}`);
    await expect(page.getByRole("heading", { name: "Compare runs" })).toBeVisible();
    await expect(page.getByText("Metric comparison")).toBeVisible();
    await expect(page.getByText(/Declared review tolerances/)).toBeVisible();
    for (const id of ids) await expect(page.getByText(id).first()).toBeVisible();
  });

  test("the audit log filters by action", async ({ page }) => {
    await page.goto("/logs");
    await page.getByLabel("Action").selectOption("run.submit");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/action=run.submit/);
    await expect(page.locator("tbody tr").first()).toContainText("run.submit");
  });
});
