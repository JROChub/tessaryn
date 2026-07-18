import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("cold authority fetch cannot be preempted by the recovery watchdog", async ({ page }) => {
  test.setTimeout(45_000);
  let delayedAuthority = false;
  await page.route("**/keyxym-v26/keyxym-v26.wasm**", async (route) => {
    delayedAuthority = true;
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    await route.continue();
  });

  const response = await page.goto("/world-cell-theater/", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await page.waitForTimeout(8_500);
  expect(delayedAuthority).toBe(true);
  await expect(page.locator("html")).not.toHaveAttribute("data-world-cell-mode", "visual-preview");
  await expect(page.locator("html")).not.toHaveAttribute("data-world-cell-mode", "boot-recovery");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative", {
    timeout: 25_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await expect(page.locator("#start-button")).toBeEnabled();
});
