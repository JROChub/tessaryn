import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const reconstructionArtifact = fileURLToPath(
  new URL("../../../conformance/reconstruction-v0/minimal-artifact.json", import.meta.url),
);
const videoLocusSource = fileURLToPath(
  new URL("./fixtures/video-locus.mp4", import.meta.url),
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
    cellsValid: 9,
    phaValid: 9,
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

  await page.waitForTimeout(1_200);
  const screenshot = await page.locator("#world-canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  const colors = new Set<string>();
  let luminous = 0;
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
      if (red + green + blue > 96) luminous += 1;
      samples += 1;
    }
  }
  expect(colors.size).toBeGreaterThan(100);
  expect(luminous / samples).toBeGreaterThan(0.03);
  expect(browserErrors).toEqual([]);
});

test("binds crystalline construction, Rootprint flow, Chronofold, and SLBIT to world state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  await page.locator('body[data-materialized="true"]').waitFor();

  const diagnostics = await page.evaluate(() => window.__tessaryn?.scene.diagnostics());
  expect(diagnostics?.cellCount).toBe(8);
  expect(diagnostics?.provenanceLinks).toBe(3);
  expect(diagnostics?.temporalManifolds).toBe(4);
  expect(diagnostics?.semanticConstellations).toBe(4);
  expect(diagnostics?.activeMeaningFields).toBe(0);
  expect(diagnostics?.assemblyPoints).toBe(212_565);
  expect(diagnostics?.continuumLayers).toBeGreaterThanOrEqual(8);
  expect(diagnostics?.temporalObservations).toBe(4);
  expect(diagnostics?.sdfVoxels).toBe(224_867);
  expect(diagnostics?.drawCalls).toBeLessThan(140);
  expect(diagnostics?.materializationMs).toBeLessThan(12_000);

  await page.locator("#verify-button").click();
  await expect(page.locator("#verify-title")).toHaveText("GROUND-TRUTH LOCUS ACCEPTED");
  await expect(page.locator("#verify-cells")).toHaveText("9 / 9 VALID");
  await expect(page.locator("#verify-pha")).toHaveText("9 / 9 VALID");
  await expect(page.locator("#verify-detail")).toContainText("212565 source-bound surfels");
  await page.locator("#verify-close").click();

  await page.locator("#scale-breath").fill("860");
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.scene.diagnostics().scaleDepth))
    .toBeGreaterThan(0.8);
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().scale)).toBe("site");

  await page.locator("#chronofold-button").click();
  await expect(page.locator("#chronofold-button")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().chronofold)).toBe(true);

  await page.evaluate(() => window.__tessaryn?.scene.selectCell("validation-moment-c"));
  await expect(page.locator("#trace-title")).toHaveText(
    "RESOLVED RETURN / VERIFIED SDF",
  );
  await page.locator('[data-trace-tab="meaning"]').click();
  await expect(page.locator("#trace-summary")).toContainText(
    "TartanAir V2 ArchViz Tiny House exact RGB-D ground truth",
  );
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().activeMeaningFields)).toBe(1);

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

test("constructs, verifies, exports, and reimports a native temporal Locus from video", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  await page.locator("#import-input").setInputFiles(videoLocusSource);
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status), {
      timeout: 180_000,
    })
    .toBe("materialized");

  expect(await page.locator("video").count()).toBe(0);
  await expect(page.locator("#app")).toHaveAttribute("data-source", "video-reconstruction");
  await expect(page.locator("#cell-count")).toHaveText("6 CELLS");
  await expect(page.locator("#moment-rail button")).toHaveCount(3);
  const result = await page.evaluate(() => ({
    local: window.__tessaryn?.localImport,
    verification: window.__tessaryn?.videoVerification,
    diagnostics: window.__tessaryn?.scene.diagnostics(),
  }));
  expect(result.local).toMatchObject({
    kind: "video",
    status: "materialized",
    worldCells: 6,
  });
  expect(result.local?.surfels).toBeGreaterThan(1_000);
  expect(result.local?.surfaceVoxels).toBeGreaterThan(100);
  expect(result.verification).toMatchObject({
    cellsValid: 6,
    phaValid: 6,
    rootprintValid: true,
    replayValid: true,
    memoryValid: true,
    errors: [],
  });
  expect(result.diagnostics).toMatchObject({
    cellCount: 6,
    temporalObservations: 3,
    provenanceLinks: 2,
  });
  expect(result.diagnostics?.assemblyPoints).toBeGreaterThan(1_000);

  const stage = await bounds(page, "#local-stage");
  const controls = await bounds(page, ".world-controls");
  expectInsideViewport(stage);
  expectInsideViewport(controls);
  expect(stage.bottom <= controls.y || stage.x >= controls.right).toBe(true);

  await page.locator("#chronofold-button").click();
  await expect(page.locator("#chronofold-button")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().chronofold)).toBe(
    true,
  );
  await page.locator("#verify-button").click();
  await expect(page.locator("#verify-title")).toHaveText("LOCAL VIDEO LOCUS ACCEPTED");
  await expect(page.locator("#verify-cells")).toHaveText("6 / 6 VALID");
  await expect(page.locator("#verify-pha")).toHaveText("6 / 6 VALID");
  await expect(page.locator("#verify-memory")).toHaveText("VALID");
  await page.locator("#verify-close").click();

  const screenshot = PNG.sync.read(await page.locator("#world-canvas").screenshot());
  const colors = new Set<string>();
  for (let y = 0; y < screenshot.height; y += Math.max(1, Math.floor(screenshot.height / 64))) {
    for (let x = 0; x < screenshot.width; x += Math.max(1, Math.floor(screenshot.width / 64))) {
      const offset = (y * screenshot.width + x) * 4;
      colors.add(
        `${String(screenshot.data[offset] ?? 0)},${String(screenshot.data[offset + 1] ?? 0)},${String(screenshot.data[offset + 2] ?? 0)}`,
      );
    }
  }
  expect(colors.size).toBeGreaterThan(24);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#local-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.tessaryn-locus\.json$/);
  const artifactPath = await download.path();
  expect(artifactPath).not.toBeNull();
  await page.locator("#import-input").setInputFiles(artifactPath!);
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status), {
      timeout: 90_000,
    })
    .toBe("materialized");
  expect(await page.evaluate(() => window.__tessaryn?.videoVerification?.errors)).toEqual([]);

  const gridMutation = JSON.parse(await readFile(artifactPath!, "utf8")) as {
    moments: Array<{ surfelGrid: { columns: number; rows: number } | null }>;
  };
  const grid = gridMutation.moments[0]?.surfelGrid;
  expect(grid).not.toBeNull();
  if (grid) [grid.columns, grid.rows] = [grid.rows, grid.columns];
  await page.locator("#import-input").setInputFiles({
    name: "grid-topology-mutation.tessaryn-locus.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(gridMutation)),
  });
  await expect(page.locator("#toast")).toContainText("GRID COMMITMENT MISMATCH");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileToast = await bounds(page, "#toast");
  expectInsideViewport(mobileToast);
  expect(mobileToast.height).toBeLessThan(80);
  expectInsideViewport(await bounds(page, "#local-close"));
});

test("indexes a local file beyond the former 128 MiB boundary", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "tessaryn-large-file-"));
  const artifact = join(directory, "large-local-artifact.bin");
  const byteLength = 129 * 1024 * 1024 + 17;
  const handle = await open(artifact, "w");
  await handle.truncate(byteLength);
  await handle.close();

  try {
    await openOrigin(page);
    await page.locator("#import-input").setInputFiles(artifact);
    await expect(page.locator("#local-stage")).toBeVisible();
    await expect(page.locator("#local-name")).toHaveText("large-local-artifact.bin");
    await expect(page.locator("#local-size")).toContainText("129 MiB");
    await expect
      .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status), {
        timeout: 90_000,
      })
      .toBe("indexed");
    const imported = await page.evaluate(() => window.__tessaryn?.localImport);
    expect(imported).toMatchObject({
      bytes: byteLength,
      kind: "binary",
      status: "indexed",
      chunkCount: 33,
    });
    expect(imported?.streamRoot).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(page.locator("#local-progress")).toHaveCSS("width", /.+/);
    await expect(page.locator("#toast")).not.toContainText("EXCEEDS");
    await page.locator("#verify-button").click();
    await expect(page.locator("#verify-title")).toHaveText("LOCAL FILE INDEXED");
    await expect(page.locator("#verify-cells")).toHaveText("STREAM ROOT");
    await expect(page.locator("#verify-memory")).toHaveText("FILE-BACKED");
    await page.locator("#verify-close").click();

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#local-export").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("large-local-artifact.tessaryn-index.json");
    const indexPath = await download.path();
    expect(indexPath).not.toBeNull();
    const index = JSON.parse(await readFile(indexPath!, "utf8")) as Record<string, unknown>;
    expect(index).toMatchObject({
      schema: "tessaryn/local-file-index/v1",
      byteLength,
      chunkCount: 33,
      streamRoot: imported?.streamRoot,
    });

    await page.locator("#import-input").setInputFiles({
      name: "empty.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(0),
    });
    await expect(page.locator("#local-name")).toHaveText("empty.bin");
    await expect
      .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status))
      .toBe("indexed");
    expect(await page.evaluate(() => window.__tessaryn?.localImport)).toMatchObject({
      bytes: 0,
      chunkCount: 0,
      streamRoot: "sha256:4a92843406d137a82b73651f63a28c335e1d940f3d3becb00a8c1fd5ab2c3d00",
    });
    await page.locator("#local-close").click();
    await expect(page.locator("#local-stage")).toBeHidden();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("browser verifier rejects a substituted source-lineage parent", async ({ page }) => {
  await openOrigin(page);
  const report = await page.evaluate(async () => {
    const runtime = window.__tessaryn;
    if (!runtime?.validationArtifact) throw new Error("validation artifact unavailable");
    const mutated = structuredClone(runtime.validationArtifact);
    mutated.source_proof.manifest.parents[0] =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    return runtime.verifyValidationArtifact(mutated);
  });
  expect(report.cellsValid).toBe(0);
  expect(report.errors).toContain("validation source Cell or PHA binding mismatch");
  expect(await page.evaluate(() => window.__tessaryn?.verification?.errors)).toEqual([]);
});

test("browser verifier rejects synthetic evidence relabelled as a real sensor", async ({
  page,
}) => {
  await openOrigin(page);
  const report = await page.evaluate(async () => {
    const runtime = window.__tessaryn;
    if (!runtime?.validationArtifact) throw new Error("validation artifact unavailable");
    const mutated = structuredClone(runtime.validationArtifact);
    mutated.source.profile.source_class = "real_sensor";
    return runtime.verifyValidationArtifact(mutated);
  });
  expect(report.cellsValid).toBe(0);
  expect(report.errors).toContain("invalid validation Locus envelope");
  expect(await page.evaluate(() => window.__tessaryn?.verification?.errors)).toEqual([]);
});

test("dataset portfolio exposes the active source and every validation layer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  await page.locator("#sources-button").click();
  await expect(page.locator("#sources-dialog")).toBeVisible();
  await expect(page.locator("#source-name")).toHaveText("TartanAir V2");
  await expect(page.locator("#source-class")).toHaveText("SYNTHETIC GROUND TRUTH");
  await expect(page.locator("#source-environment")).toHaveText("ArchVizTinyHouseDay");
  await expect(page.locator("#portfolio-list .portfolio-row")).toHaveCount(4);
  expectInsideViewport(await bounds(page, "#sources-dialog"));
  expectInsideViewport(await bounds(page, "#sources-close"));
  await page.locator("#sources-close").click();
  await expect(page.locator("#sources-dialog")).not.toBeVisible();
});

test("mobile dataset portfolio remains scrollable and dismissible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOrigin(page);
  await page.locator("#sources-button").click();
  await expect(page.locator("#sources-dialog")).toBeVisible();
  expectInsideViewport(await bounds(page, "#sources-dialog"));
  expectInsideViewport(await bounds(page, "#sources-close"));
  await expect(page.locator("#portfolio-list .portfolio-row")).toHaveCount(4);
  await page.locator("#sources-close").click();
  await expect(page.locator("#sources-dialog")).not.toBeVisible();
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

    await page.evaluate(() => window.__tessaryn?.scene.selectCell("validation-moment-c"));
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
  await page.locator("#import-input").setInputFiles({
    name: "offline-local.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("offline-file-backed-index"),
  });
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status))
    .toBe("indexed");
  expect(await page.evaluate(() => window.__tessaryn?.localImport?.streamRoot)).toMatch(
    /^sha256:[0-9a-f]{64}$/,
  );
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
