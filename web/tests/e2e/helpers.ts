import { expect, type Page } from "@playwright/test";

export const ENGINEER = { email: "engineer@grid.local", password: "Stability!2026" };
export const VIEWER = { email: "viewer@grid.local", password: "Observer!2026" };
export const LOCKED = { email: "locked@grid.local", password: "Locked!2026" };

/**
 * Waits until React has attached its fiber to the DOM.
 *
 * Playwright can click a server-rendered control before hydration, which would
 * silently drop the event; this probe removes that race.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const element = document.querySelector("form") ?? document.querySelector("main") ?? document.body;
    return Object.keys(element).some((key) => key.startsWith("__react"));
  });
}

export async function login(page: Page, credentials = ENGINEER): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: false }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Dispatches an analysis through the workspace and returns the new run id. */
export async function submitRun(page: Page, analysis: "pf" | "sssa" | "ts" | "ibr" = "pf"): Promise<string> {
  await page.goto(`/analysis/new?analysis=${analysis}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page).toHaveURL(/\/runs\/run-\d+/);
  const url = page.url();
  return url.split("/runs/")[1]!.split("?")[0]!;
}

export async function firstLiveRunId(page: Page): Promise<string | null> {
  const body = await apiGet<{ items: { id: string; status: string }[] }>(page, "/api/runs?pageSize=50");
  return body.items.find((item) => !["converged", "failed", "cancelled"].includes(item.status))?.id ?? null;
}

/**
 * Calls the REST API from inside the page so the httpOnly session cookie is
 * attached (Playwright's `page.request` does not share it).
 */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { cache: "no-store" });
    return (await response.json()) as unknown;
  }, path) as Promise<T>;
}

export async function apiPost<T>(page: Page, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ target, payload }) => {
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return (await response.json()) as unknown;
    },
    { target: path, payload: body },
  ) as Promise<T>;
}

/** Ids of completed runs for a given analysis family. */
export async function completedRunIds(page: Page, analysis: "pf" | "sssa" | "ts" | "ibr"): Promise<string[]> {
  const body = await apiGet<{ items: { id: string }[] }>(
    page,
    `/api/runs?pageSize=50&analysis=${analysis}&status=converged`,
  );
  return body.items.map((item) => item.id);
}
