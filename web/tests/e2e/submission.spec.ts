import { expect, test } from "@playwright/test";

import { login, submitRun } from "./helpers";

test.describe("analysis submission", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("forms are context sensitive per analysis type", async ({ page }) => {
    await page.goto("/analysis/new?analysis=pf");
    await expect(page.getByLabel("Tolerance", { exact: false })).toBeVisible();
    await expect(page.getByLabel("End time", { exact: false })).toHaveCount(0);

    // Gauss-Seidel exposes the acceleration factor; Newton-Raphson does not.
    await expect(page.getByLabel("Acceleration factor", { exact: false })).toHaveCount(0);
    await page.getByLabel("Method").selectOption("gauss_seidel");
    await expect(page.getByLabel("Acceleration factor", { exact: false })).toBeVisible();

    await page.getByRole("radio", { name: /Time-domain simulation/ }).click();
    await expect(page.getByLabel("End time", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Integrator")).toBeVisible();
    await expect(page.getByLabel("Tolerance", { exact: false })).toHaveCount(0);

    // Fault timing appears only once a fault bus is entered.
    await expect(page.getByLabel("Fault applied", { exact: false })).toHaveCount(0);
    await page.getByLabel("Fault bus", { exact: false }).fill("7");
    await expect(page.getByLabel("Fault applied", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Fault cleared", { exact: false })).toBeVisible();

    await page.getByRole("radio", { name: /IBR study/ }).click();
    await expect(page.getByLabel("IBR product")).toBeVisible();
    await expect(page.getByText(/AGSI\+\+ switching cases generate/)).toBeVisible();
  });

  test("out-of-range values block submission and are explained", async ({ page }) => {
    await page.goto("/analysis/new?analysis=pf");
    await page.getByLabel("Tolerance", { exact: false }).fill("0");
    await expect(page.getByRole("alert").filter({ hasText: /Tolerance must be greater than 0/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run analysis" })).toBeDisabled();

    await page.getByLabel("Tolerance", { exact: false }).fill("1e-8");
    await page.getByLabel("Max iterations").fill("0");
    await expect(page.getByRole("button", { name: "Run analysis" })).toBeDisabled();

    await page.getByLabel("Max iterations").fill("25");
    await expect(page.getByRole("button", { name: "Run analysis" })).toBeEnabled();
    await expect(page.getByText("ready").first()).toBeVisible();
  });

  test("the JSON preview mirrors the configuration and the CLI equivalent", async ({ page }) => {
    await page.goto("/analysis/new?analysis=pf");
    await page.getByLabel("Method").selectOption("fdpf_xb");
    await page.getByLabel("Tolerance", { exact: false }).fill("1e-10");
    const preview = page.locator("pre").first();
    await expect(preview).toContainText('"pf_method": "fdpf_xb"');
    await expect(preview).toContainText('"tolerance": 1e-10');
    await expect(page.getByText(/power-flow --analysis pf --case ieee14 --method fdpf_xb/)).toBeVisible();
  });

  test("a dispatched run streams telemetry and reaches a terminal state", async ({ page }) => {
    const runId = await submitRun(page, "pf");
    await expect(page.locator("#main").getByText(runId, { exact: true }).first()).toBeVisible();

    // Progress and logs arrive over SSE.
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByText("stream live")).toBeVisible();
    await expect(page.getByRole("log")).toContainText("Loaded case", { timeout: 30_000 });
    await expect(page.getByText(/Converged|Failed/).first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole("link", { name: "Open results" }).click();
    await expect(page).toHaveURL(new RegExp(`/results/${runId}`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a long run can be cancelled from the monitor", async ({ page }) => {
    await page.goto("/analysis/new?analysis=ibr&case=ieee14_switch");
    await page.getByRole("button", { name: "Run analysis" }).click();
    await expect(page).toHaveURL(/\/runs\/run-\d+/);

    await expect(page.getByText("Running", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Cancel run" }).click();
    await expect(page.getByRole("dialog", { name: /cancel this run/i })).toBeVisible();
    await page.getByRole("button", { name: "Cancel run", exact: true }).last().click();

    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/cancelled_by_user/)).toBeVisible();
  });

  test("the stream reconnects after a transport failure without losing the run", async ({ page }) => {
    await page.goto("/analysis/new?analysis=ibr&case=ieee14_switch");
    await page.getByRole("button", { name: "Run analysis" }).click();
    await expect(page).toHaveURL(/\/runs\/run-\d+/);
    const runId = page.url().split("/runs/")[1]!;

    await expect(page.getByText("stream live")).toBeVisible({ timeout: 30_000 });

    // Break the SSE transport once, then let the client resume from its cursor.
    let aborted = false;
    await page.route("**/stream?**", async (route) => {
      if (!aborted) {
        aborted = true;
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.reload();

    await expect(page.getByText(/reconnecting|stream live/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("stream live")).toBeVisible({ timeout: 40_000 });
    await expect(page.locator("#main").getByText(runId, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("log")).toContainText(/t = |Loaded|Dispatched/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Cancel run" }).click();
    await page.getByRole("button", { name: "Cancel run", exact: true }).last().click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
