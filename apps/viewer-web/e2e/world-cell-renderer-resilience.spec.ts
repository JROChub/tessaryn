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

test("capture owns the stage and technical instruments open as a drawer", async ({ page }) => {
  await page.goto("/world-cell-theater/", { waitUntil: "domcontentloaded" });
  const stage = await page.locator(".stage-panel").boundingBox();
  expect(stage?.width ?? 0).toBeGreaterThan(1_000);
  expect(stage?.height ?? 0).toBeGreaterThan(500);
  await expect(page.locator(".instrument-stack")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".advanced-capture")).toBeHidden();
  await page.locator("#details-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-details-open", "true");
  await expect(page.locator(".instrument-stack")).toHaveAttribute("aria-hidden", "false");
  await page.locator("#details-close").click();
  await expect(page.locator("html")).toHaveAttribute("data-details-open", "false");
  await page.locator("#advanced-button").click();
  await expect(page.locator("#advanced-button")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".advanced-capture")).toBeVisible();
});
