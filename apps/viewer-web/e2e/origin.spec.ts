import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const reconstructionArtifact = fileURLToPath(
  new URL("../../../conformance/reconstruction-v0/minimal-artifact.json", import.meta.url),
);

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
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
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
  await page.locator('body[data-materialized="true"]').waitFor();
  const metrics = await page.evaluate(() => window.__tessaryn?.metrics);
  expect(metrics?.firstStructureMs).toBeGreaterThan(0);
  expect(metrics?.materializedMs).toBeGreaterThan(metrics?.firstStructureMs ?? 0);
  expect(metrics?.verificationMs).toBeGreaterThan(0);

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
  expect(nonblack / samples).toBeGreaterThan(0.35);
  expect(browserErrors).toEqual([]);
});

test("binds crystalline construction, Rootprint flow, Chronofold, and SLBIT to world state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  await page.locator('body[data-materialized="true"]').waitFor();

  const diagnostics = await page.evaluate(() => window.__tessaryn?.scene.diagnostics());
  expect(diagnostics?.cellCount).toBe(18);
  expect(diagnostics?.provenanceLinks).toBeGreaterThan(0);
  expect(diagnostics?.temporalManifolds).toBe(3);
  expect(diagnostics?.semanticConstellations).toBe(17);
  expect(diagnostics?.activeMeaningFields).toBeGreaterThan(0);
  expect(diagnostics?.assemblyPoints).toBeGreaterThan(150);
  expect(diagnostics?.continuumLayers).toBeGreaterThanOrEqual(6);
  expect(diagnostics?.drawCalls).toBeLessThan(140);
  expect(diagnostics?.materializationMs).toBeLessThan(4_000);

  await page.locator("#chronofold-button").click();
  await expect(page.locator("#chronofold-button")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().chronofold)).toBe(true);

  await page.evaluate(() => window.__tessaryn?.scene.selectCell("meaning-layer"));
  await expect(page.locator("#trace-title")).toHaveText("ORIGIN INTERPRETATION");
  await page.locator('[data-trace-tab="meaning"]').click();
  await expect(page.locator("#trace-summary")).toContainText(
    "SLBIT meaning is independently bound",
  );

  await page.locator("#evidence-button").click();
  await expect(page.locator("#evidence-button")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().activeMeaningFields)).toBe(0);
  expect(await page.evaluate(() => window.__tessaryn?.verification?.errors)).toEqual([]);
});

test("imports, reverifies, and renders a reconstruction artifact without upload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  await page.locator("#import-input").setInputFiles(reconstructionArtifact);
  await expect(page.locator("#verify-title")).toHaveText("LOCAL CAPTURE ACCEPTED");
  await expect(page.locator("#app")).toHaveAttribute("data-source", "imported");
  await expect(page.locator("#cell-count")).toHaveText("2 CELLS");
  await expect(page.locator("#verify-cells")).toHaveText("2 / 2 VALID");
  await expect(page.locator("#verify-pha")).toHaveText("2 / 2 VALID");
  await expect(page.locator("#verify-rootprint")).toHaveText("VALID");
  await expect(page.locator("#verify-replay")).toHaveText("VALID");
  await expect(page.locator("#verify-memory")).toHaveText("VALID");
  await expect(page.locator("#chronofold-button")).toBeDisabled();
  expect(await page.evaluate(() => window.__tessaryn?.importedVerification)).toMatchObject({
    cellsValid: 2,
    phaValid: 2,
    rootprintValid: true,
    replayValid: true,
    memoryValid: true,
    reportValid: true,
    rawFramesAbsent: true,
    voxels: 90,
    errors: [],
  });
  expect(
    await page.evaluate(() => window.__tessaryn?.importedVerification?.surfels.length),
  ).toBe(18);
  await page.locator("#verify-close").click();
  await expect(page.locator("#trace-title")).toHaveText("IMPORTED RGB-D OBSERVATION");
  await page.locator("#trace-close").click();
  await page.locator("#challenge-button").click();
  for (const [mutation, code] of [
    ["coordinate", "CELL_ID_MISMATCH"],
    ["fingerprint", "PHA_CORE_INVALID"],
    ["semantic", "PACKET_DIGEST_MISMATCH"],
  ] as const) {
    await page.locator(`[data-mutation="${mutation}"]`).click();
    await expect(page.locator("#rejection-trace > b")).toHaveText(code);
  }
  await page.locator("#challenge-close").click();

  const screenshot = await page.locator("#world-canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  const colors = new Set<string>();
  for (let y = 0; y < image.height; y += Math.max(1, Math.floor(image.height / 72))) {
    for (let x = 0; x < image.width; x += Math.max(1, Math.floor(image.width / 72))) {
      const index = (y * image.width + x) * 4;
      colors.add(
        `${String(image.data[index] ?? 0)},${String(image.data[index + 1] ?? 0)},${String(image.data[index + 2] ?? 0)}`,
      );
    }
  }
  expect(colors.size).toBeGreaterThan(20);
});

test("rejects duplicate-key and binary mutations before materialization", async ({ page }) => {
  await openOrigin(page);
  const valid = await readFile(reconstructionArtifact, "utf8");
  const duplicate = valid.replace(
    '"schema":"tessaryn/reconstruction-artifact/v0"',
    '"schema":"invalid","schema":"tessaryn/reconstruction-artifact/v0"',
  );
  await page.locator("#import-input").setInputFiles({
    name: "duplicate.json",
    mimeType: "application/json",
    buffer: Buffer.from(duplicate),
  });
  await expect(page.locator("#toast")).toContainText("DUPLICATE JSON KEY");
  await expect(page.locator("#app")).not.toHaveAttribute("data-source", "imported");

  const tampered = JSON.parse(valid) as {
    report: { observation: { public_chunk: string } };
  };
  const chunk = tampered.report.observation.public_chunk;
  tampered.report.observation.public_chunk =
    chunk.slice(0, 30) + (chunk[30] === "A" ? "B" : "A") + chunk.slice(31);
  await page.locator("#import-input").setInputFiles({
    name: "tampered.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(tampered)),
  });
  await expect(page.locator("#toast")).toContainText("OBSERVATION CELL");
  await expect(page.locator("#app")).not.toHaveAttribute("data-source", "imported");
});

test("mobile import keeps verification and close controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOrigin(page);
  await page.locator("#import-input").setInputFiles(reconstructionArtifact);
  await expect(page.locator("#verify-title")).toHaveText("LOCAL CAPTURE ACCEPTED");
  expectInsideViewport(await bounds(page, "#verification-dialog"));
  expectInsideViewport(await bounds(page, "#verify-close"));
  await page.locator("#verify-close").click();
  expectInsideViewport(await bounds(page, "#trace-drawer"));
  expectInsideViewport(await bounds(page, "#trace-close"));
  await page.locator("#trace-close").click();
  await page.locator("#challenge-button").click();
  expectInsideViewport(await bounds(page, "#challenge-drawer"));
  expectInsideViewport(await bounds(page, "#challenge-close"));
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const) {
  test(`${name} keeps Trace and Challenge controls reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openOrigin(page);

    const toast = page.locator("#toast");
    await toast.evaluate((element) => element.classList.add("visible"));
    const toastBounds = await bounds(page, "#toast");
    expectInsideViewport(toastBounds);
    if (await page.locator(".origin-status").isVisible()) {
      const statusBounds = await bounds(page, ".origin-status");
      const intersects =
        toastBounds.x < statusBounds.right &&
        toastBounds.right > statusBounds.x &&
        toastBounds.y < statusBounds.bottom &&
        toastBounds.bottom > statusBounds.y;
      expect(intersects).toBe(false);
    }

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
    await page.locator("#challenge-close").click();
    await expect(page.locator("#challenge-drawer")).not.toHaveClass(/open/);
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
