import { expect, test } from "@playwright/test";

import { login } from "./helpers";

test.describe("navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("the sidebar reaches every primary destination", async ({ page }) => {
    const destinations: [string, RegExp, RegExp][] = [
      ["New analysis", /\/analysis\/new/, /New analysis/i],
      ["Runs", /\/runs$/, /Run history/],
      ["Results", /\/results$/, /Completed studies/],
      ["Compare", /\/compare/, /Compare runs/],
      ["Presets", /\/presets/, /Analysis presets/],
      ["Logs", /\/logs/, /Audit log/],
      ["Settings", /\/settings/, /Settings/],
      ["Dashboard", /\/dashboard/, /Study fleet overview/],
    ];

    for (const [label, url, heading] of destinations) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: heading })).toBeVisible();
    }
  });

  test("breadcrumbs reflect the current route", async ({ page }) => {
    await page.goto("/analysis/new");
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toContainText("Analysis");
    await expect(breadcrumb).toContainText("New analysis");
  });

  test("the sidebar collapses and remembers the state", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.reload();
    await expect(nav.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  });

  test("the command palette opens with Ctrl+K and navigates", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palette = page.getByPlaceholder("Jump to a page, run, or start an analysis…");
    await expect(palette).toBeVisible();
    await palette.fill("Audit");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/logs/);
  });

  test("the theme toggle switches themes and persists the choice", async ({ page }) => {
    const html = page.locator("html");
    const initial = (await html.getAttribute("data-theme")) ?? "dark";
    const target = initial === "light" ? "dark" : "light";

    await page.getByRole("button", { name: new RegExp(`switch to ${target} theme`, "i") }).click();
    await expect(html).toHaveAttribute("data-theme", target);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", target);

    await page.getByRole("button", { name: new RegExp(`switch to ${initial} theme`, "i") }).click();
    await expect(html).toHaveAttribute("data-theme", initial);
  });

  test("an unknown run id renders the not-found view", async ({ page }) => {
    await page.goto("/runs/run-does-not-exist");
    await expect(page.getByText(/resource not found/i)).toBeVisible();
  });

  test("the tablet layout keeps navigation reachable", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /study fleet overview/i })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });
});
