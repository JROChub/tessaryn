import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

async function openOrigin(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('body[data-ready="true"]').waitFor();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__tessaryn?.verification)))
    .toBe(true);
}

async function bounds(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return {
      x: rectangle.x,
      y: rectangle.y,
      right: rectangle.right,
      bottom: rectangle.bottom,
      width: rectangle.width,
      height: rectangle.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
}

function expectInsideViewport(rectangle: Awaited<ReturnType<typeof bounds>>): void {
  expect(rectangle.x).toBeGreaterThanOrEqual(0);
  expect(rectangle.y).toBeGreaterThanOrEqual(0);
  expect(rectangle.right).toBeLessThanOrEqual(rectangle.viewportWidth);
  expect(rectangle.bottom).toBeLessThanOrEqual(rectangle.viewportHeight);
}

test("locally verifies every committed layer and renders nonblank canvas pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  const report = await page.evaluate(() => window.__tessaryn?.verification);
  expect(report).toMatchObject({
    cellsValid: 18,
    phaValid: 18,
    rootprintValid: true,
    replayValid: true,
    memoryValid: true,
    errors: [],
  });

  const screenshot = await page.locator("#world-canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  const colors = new Set<string>();
  let nonblack = 0;
  let samples = 0;
  const stepX = Math.max(1, Math.floor(image.width / 96));
  const stepY = Math.max(1, Math.floor(image.height / 96));
  for (let y = 0; y < image.height; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      const index = (y * image.width + x) * 4;
      const red = image.data[index] ?? 0;
      const green = image.data[index + 1] ?? 0;
      const blue = image.data[index + 2] ?? 0;
      colors.add(`${red},${green},${blue}`);
      if (red + green + blue > 15) nonblack += 1;
      samples += 1;
    }
  }
  expect(colors.size).toBeGreaterThan(100);
  expect(nonblack / samples).toBeGreaterThan(0.8);
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const) {
  test(`${name} keeps Trace and Challenge controls reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openOrigin(page);
    await page.evaluate(() => window.__tessaryn?.scene.selectCell("archive-c"));
    expectInsideViewport(await bounds(page, "#trace-drawer"));
    const traceClose = await bounds(page, "#trace-close");
    expectInsideViewport(traceClose);
    expect(traceClose.width).toBeGreaterThanOrEqual(36);
    expect(traceClose.height).toBeGreaterThanOrEqual(36);
    await page.locator("#trace-close").click();

    await page.locator("#challenge-button").click();
    expectInsideViewport(await bounds(page, "#challenge-drawer"));
    expectInsideViewport(await bounds(page, "#challenge-close"));
    await page.locator('[data-mutation="coordinate"]').click();
    await expect(page.locator("#rejection-trace > b")).toHaveText("CELL_ID_MISMATCH");
    await page.locator('[data-mutation="fingerprint"]').click();
    await expect(page.locator("#rejection-trace > b")).toHaveText("PHA_CORE_INVALID");
    await page.locator('[data-mutation="semantic"]').click();
    await expect(page.locator("#rejection-trace > b")).toHaveText(
      "PACKET_DIGEST_MISMATCH",
    );
  });
}

test("production service worker reconstructs and verifies offline", async ({ context, page }) => {
  await openOrigin(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await openOrigin(page);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await openOrigin(page);
  await expect(page.locator("#network-state")).toContainText("OFFLINE READY");
  expect(await page.evaluate(() => window.__tessaryn?.verification?.errors)).toEqual([]);
});

test.describe("reduced motion", () => {
  test("preserves verification while suppressing movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openOrigin(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    const duration = await page
      .locator("#boot-field")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
    expect(duration).toBeLessThan(0.001);
    expect(await page.evaluate(() => window.__tessaryn?.verification?.errors)).toEqual([]);
  });
});
