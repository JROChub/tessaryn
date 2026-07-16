import { expect, test } from "@playwright/test";

test("iPhone WebKit reaches World Cell Scan V4 without waiting for service-worker authority", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "visual-preview", {
    timeout: 15_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-visual-renderer", "world-cell-scan-v4");
  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "ready");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#start-button")).toHaveText("START WORLD CELL SCAN");
  await expect(page.locator("#stage-message b")).toHaveText("WORLD CELL SCAN V4 READY");

  const builtResponse = await page.request.get("/world-cell-theater.html");
  expect(builtResponse.ok()).toBe(true);
  const builtHtml = await builtResponse.text();
  expect(builtHtml).not.toContain("world-cell-authority-entry.ts");
  expect(builtHtml).not.toMatch(/(?:src|href)=["']\/?src\//u);
  expect(builtHtml).toMatch(/assets\/.+\.js/u);
  expect(pageErrors).toEqual([]);
});

test("iPhone WebKit exposes a basic camera fallback when the release module fails", async ({ page }) => {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  const response = await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "boot-recovery", {
    timeout: 15_000,
  });
  await expect(page.locator("#stage-message b")).toHaveText("WORLD CELL MODULE UNAVAILABLE");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#start-button")).toHaveText("START BASIC CAMERA");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
});
