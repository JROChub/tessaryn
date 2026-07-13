import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("constructs the verified TESSARYN logo mansion as native 4D architecture", async ({
  page,
}) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?object=tessaryn-logo-mansion-01");
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator("#app")).toHaveAttribute("data-source", "cinematic", {
    timeout: 30_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.cinematicVerification?.accepted))
    .toBe(true);

  expect(await page.locator("video").count()).toBe(0);
  await expect(page.locator("#local-name")).toHaveText("TESSARYN / LOGO MANSION");
  await expect(page.locator("#local-kind")).toHaveText(
    "PUBLIC OBJECT WEAVE / LOCALLY VERIFIED",
  );
  await expect(page.locator("#cinematic-controls")).toBeVisible();
  await expect(page.locator("#moment-rail button")).toHaveCount(4);
  await expect(page.locator("#cell-count")).toHaveText("96 WORLD CELLS");

  const verification = await page.evaluate(() => window.__tessaryn?.cinematicVerification);
  expect(verification).toMatchObject({
    accepted: true,
    manifestValid: true,
    descriptorValid: true,
    mediaValid: true,
    cellValid: true,
    phaValid: true,
    rootprintValid: true,
    replayValid: true,
    memoryValid: true,
    verifiedMediaChunks: 1,
    errors: [],
  });

  const diagnostics = await page.evaluate(() => window.__tessaryn?.scene.diagnostics());
  expect(diagnostics).toMatchObject({
    cellCount: 96,
    provenanceLinks: 95,
    temporalManifolds: 4,
    semanticConstellations: 6,
    activeMeaningFields: 6,
    assemblyPoints: 96,
    temporalObservations: 4,
    sdfVoxels: 0,
  });
  expect(diagnostics?.drawCalls).toBeLessThan(
    diagnostics?.visualProfile === "constrained" ? 70 : 120,
  );

  await page.locator("#cinematic-play").click();
  await page.locator("#cinematic-time").fill("750");
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.scene.cinematicTime()))
    .toBeGreaterThan(0.74);
  await page.locator("#chronofold-button").click();
  await expect(page.locator("#chronofold-button")).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() =>
    window.__tessaryn?.scene.selectCell("cinematic-tessaryn-logo-mansion-01"),
  );
  await expect(page.locator("#trace-title")).toHaveText("TESSARYN / LOGO MANSION");
  await page.locator('[data-trace-tab="meaning"]').click();
  await expect(page.locator("#trace-summary")).toContainText("interlocking TESSARYN diamonds");
  await page.locator("#trace-close").click();

  await page.locator("#objects-button").click();
  await page.locator("#object-search").fill("mansion");
  await expect(page.locator(".object-entry")).toHaveCount(1);
  await expect(page.locator(".object-entry code")).toHaveText("tessaryn-logo-mansion-01");
  await page.locator("#objects-close").click();

  const screenshot = await page.locator("#world-canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  const colors = new Set<string>();
  let visible = 0;
  let samples = 0;
  for (let y = 0; y < image.height; y += Math.max(1, Math.floor(image.height / 96))) {
    for (let x = 0; x < image.width; x += Math.max(1, Math.floor(image.width / 96))) {
      const index = (y * image.width + x) * 4;
      const red = image.data[index] ?? 0;
      const green = image.data[index + 1] ?? 0;
      const blue = image.data[index + 2] ?? 0;
      colors.add(`${red},${green},${blue}`);
      if (red + green + blue > 18) visible += 1;
      samples += 1;
    }
  }
  expect(colors.size).toBeGreaterThan(120);
  expect(visible / samples).toBeGreaterThan(0.18);
  expect(browserErrors).toEqual([]);
});
