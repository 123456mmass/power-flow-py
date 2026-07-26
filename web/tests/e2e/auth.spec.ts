import { expect, test } from "@playwright/test";

import { ENGINEER, LOCKED, login, waitForHydration } from "./helpers";

test.describe("authentication", () => {
  test("unauthenticated visits are redirected to the login page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("client-side validation blocks an invalid email", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: false }).fill("whatever");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong credentials surface a failure with remaining attempts", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(ENGINEER.email);
    await page.getByLabel("Password", { exact: false }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Sign-in failed" })).toBeVisible();
    await expect(page.getByText(/attempt\(s\) left/)).toBeVisible();
  });

  test("a locked account is reported distinctly", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(LOCKED.email);
    await page.getByLabel("Password", { exact: false }).fill(LOCKED.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Account locked" })).toBeVisible();
  });

  test("the dev-only demo panel fills credentials", async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: /local development credentials/i })).toBeVisible();
    // Blur the autofocused email field first: its validation message would
    // otherwise appear between mousedown and mouseup and shift the panel.
    await page.getByRole("heading", { name: "Sign in" }).click();
    await page.getByRole("button", { name: new RegExp(ENGINEER.email) }).click();
    await expect(page.getByLabel("Email")).toHaveValue(ENGINEER.email);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("sign-out clears the session", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: /Dana Okafor|engineer@grid.local/ }).first().click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/runs");
    await expect(page).toHaveURL(/\/login/);
  });
});
