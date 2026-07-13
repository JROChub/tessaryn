import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("locally verifies and displays the 4D logo mansion", async ({ page }) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mansion.html");
  await page.locator('#mansion-app[data-ready="true"]').waitFor({ timeout: 40_000 });

  await expect(page.locator("#mansion-proof")).toHaveAttribute("data-state", "accepted");
  await expect(page.locator("#mansion-proof-label")).toContainText("LOCALLY VERIFIED");
  await expect(page.locator("#mansion-moments button")).toHaveCount(4);
  await expect(page.locator("#mansion-cell")).not.toHaveText("PENDING");

  const diagnostics = await page.evaluate(() =>
    (window as unknown as { __tessarynMansion?: { diagnostics: () => unknown } })
      .__tessarynMansion?.diagnostics(),
  );
  expect(diagnostics).toMatchObject({ wings: 3, portals: 3 });

  await page.waitForTimeout(800);
  const screenshot = await page.locator("#mansion-canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let visible = 0;
  let samples = 0;
  const stepX = Math.max(1, Math.floor(image.width / 96));
  const stepY = Math.max(1, Math.floor(image.height / 96));
  for (let y = 0; y < image.height; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      const offset = (y * image.width + x) * 4;
      if (
        (image.data[offset] ?? 0) +
          (image.data[offset + 1] ?? 0) +
          (image.data[offset + 2] ?? 0) >
        18
      ) {
        visible += 1;
      }
      samples += 1;
    }
  }
  expect(visible / samples).toBeGreaterThan(0.16);

  await page.locator("#mansion-chronofold").click();
  await expect(page.locator("#mansion-chronofold")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#mansion-time").fill("760");
  await expect(page.locator("#mansion-app")).toHaveAttribute("data-moment", "continuum");
  expect(browserErrors).toEqual([]);
});
