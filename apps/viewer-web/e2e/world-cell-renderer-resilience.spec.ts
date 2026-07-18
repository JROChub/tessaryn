import { expect, test } from "@playwright/test";

test("verified capture remains available when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type, options) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return original.call(this, type, options as never);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto("/world-cell-theater/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative", {
    timeout: 15_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-renderer", "canvas-2d");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#gpu-badge")).toHaveText("WORKER WASM READY");
});

test("advanced instrument controls are progressive disclosure", async ({ page }) => {
  await page.goto("/world-cell-theater/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".advanced-capture")).toBeHidden();
  await expect(page.locator(".expert-only").first()).toBeHidden();
  await page.locator("#advanced-button").click();
  await expect(page.locator("#advanced-button")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".advanced-capture")).toBeVisible();
  await expect(page.locator(".expert-only").first()).toBeVisible();
});
