import { expect, test, type Page } from "@playwright/test";

import { completedRunIds, login } from "./helpers";

const VIEWPORTS = [
  { name: "desktop", width: 1680, height: 1050 },
  { name: "laptop", width: 1366, height: 900 },
  { name: "tablet", width: 900, height: 1200 },
];

const DIR = "screenshots";

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
}

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    window.localStorage.setItem("pfw-theme", value);
  }, theme);
  await page.waitForTimeout(200);
}

test.describe("visual verification", () => {
  test("captures login, dashboard, run monitor and results at three widths", async ({ page }) => {
    test.slow();

    // A live run to photograph the monitor with streaming data.
    await login(page);
    await page.goto("/analysis/new?analysis=ibr&case=ieee14_switch");
    await page.getByRole("button", { name: "Run analysis" }).click();
    await expect(page).toHaveURL(/\/runs\/run-\d+/);
    const runId = page.url().split("/runs/")[1]!;
    await expect(page.getByText("stream live")).toBeVisible({ timeout: 30_000 });

    const switchingRunId = (await completedRunIds(page, "ibr"))[0];
    const pfRunId = (await completedRunIds(page, "pf"))[0];
    const sssaRunId = (await completedRunIds(page, "sssa"))[0];

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto("/dashboard");
      await setTheme(page, "dark");
      await expect(page.getByRole("heading", { name: /study fleet overview/i })).toBeVisible();
      await shoot(page, `dashboard-${viewport.name}-dark`);

      await page.goto(`/runs/${runId}`);
      await expect(page.getByText(/stream live|Converged|Cancelled/)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      await shoot(page, `run-monitor-${viewport.name}-dark`);

      if (pfRunId) {
        await page.goto(`/results/${pfRunId}`);
        await expect(page.getByRole("heading", { name: "Bus results" })).toBeVisible({ timeout: 30_000 });
        await shoot(page, `results-pf-${viewport.name}-dark`);
      }

      if (sssaRunId) {
        await page.goto(`/results/${sssaRunId}`);
        await expect(page.locator(".js-plotly-plot")).toBeVisible({ timeout: 40_000 });
        await page.waitForTimeout(900);
        await shoot(page, `results-sssa-${viewport.name}-dark`);
      }

      if (switchingRunId) {
        await page.goto(`/results/${switchingRunId}`);
        await expect(page.getByRole("heading", { name: /Simulation summary/ })).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(1200);
        await shoot(page, `results-ibr-${viewport.name}-dark`);
      }

      await page.goto("/analysis/new?analysis=ibr&case=ieee14_switch");
      await expect(page.getByLabel("IBR product")).toBeVisible();
      await shoot(page, `new-analysis-${viewport.name}-dark`);

      await page.goto("/runs");
      await expect(page.getByRole("heading", { name: /run history/i })).toBeVisible();
      await shoot(page, `runs-${viewport.name}-dark`);
    }

    // Light theme coverage on the key surfaces.
    await page.setViewportSize({ width: 1680, height: 1050 });
    await page.goto("/dashboard");
    await setTheme(page, "light");
    await expect(page.getByRole("heading", { name: /study fleet overview/i })).toBeVisible();
    await shoot(page, "dashboard-desktop-light");

    await page.goto(`/runs/${runId}`);
    await setTheme(page, "light");
    await page.waitForTimeout(2000);
    await shoot(page, "run-monitor-desktop-light");

    if (pfRunId) {
      await page.goto(`/results/${pfRunId}`);
      await setTheme(page, "light");
      await expect(page.getByRole("heading", { name: "Bus results" })).toBeVisible({ timeout: 30_000 });
      await shoot(page, "results-pf-desktop-light");
    }

    // Login page in both themes (signed out).
    await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
    await page.context().clearCookies();
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/login");
      await setTheme(page, "dark");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await shoot(page, `login-${viewport.name}-dark`);
    }
    await page.goto("/login");
    await setTheme(page, "light");
    await shoot(page, "login-desktop-light");
  });
});
