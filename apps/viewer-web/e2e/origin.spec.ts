import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const reconstructionArtifact = fileURLToPath(
  new URL("../../../conformance/reconstruction-v0/minimal-artifact.json", import.meta.url),
);
const validationLocusArtifact = fileURLToPath(
  new URL("../public/world/archviz-tiny-house-locus.json", import.meta.url),
);

async function openOrigin(page: Page): Promise<void> {
  await page.goto("/?origin=validation");
  await page.locator('body[data-ready="true"]').waitFor();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__tessaryn?.verification)))
    .toBe(true);
}

async function openCinematicObject(page: Page): Promise<void> {
  await page.goto("/?object=nostalgia-continuum-monument-01");
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator("#app")).toHaveAttribute("data-source", "cinematic", {
    timeout: 30_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.cinematicVerification?.accepted))
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

function triangleBytes(): Buffer {
  const bytes = Buffer.alloc(42);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  [0, 1, 2].forEach((value, index) => bytes.writeUInt16LE(value, 36 + index * 2));
  return bytes;
}

function triangleGltf(binaryUri = true): Buffer {
  const binary = triangleBytes();
  return Buffer.from(
    JSON.stringify({
      asset: { version: "2.0", generator: "tessaryn-intake-test" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [
        binaryUri
          ? { byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString("base64")}` }
          : { byteLength: binary.length },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      ],
    }),
  );
}

function triangleGlb(): Buffer {
  const binary = triangleBytes();
  const json = triangleGltf(false);
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const result = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonLength);
  json.copy(result, 20);
  const binaryHeader = 20 + jsonLength;
  result.writeUInt32LE(binaryLength, binaryHeader);
  result.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(result, binaryHeader + 8);
  return result;
}

const sourceGeometryCases = [
  {
    name: "triangle.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
    format: "glb",
  },
  {
    name: "triangle.gltf",
    mimeType: "model/gltf+json",
    buffer: triangleGltf(),
    format: "gltf",
  },
  {
    name: "triangle.obj",
    mimeType: "model/obj",
    buffer: Buffer.from("o triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"),
    format: "obj",
  },
  {
    name: "triangle.ply",
    mimeType: "model/ply",
    buffer: Buffer.from(
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\n" +
      "property float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n" +
      "0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n",
    ),
    format: "ply",
  },
  {
    name: "triangle.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(
      "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\n" +
      "vertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n",
    ),
    format: "stl",
  },
] as const;

test("keeps synthetic ground truth in an opt-in lab and returns to the private Origin", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator("#app")).toHaveAttribute("data-source", "reference");
  await expect(page.locator("#origin-name")).toHaveText("LOCAL CONSTRUCTION FIELD");
  await expect(page.locator("#origin-status")).toContainText("ADD YOUR CAPTURE");
  await expect(page.locator("#construct-button")).toBeVisible();
  expectInsideViewport(await bounds(page, "#construct-button"));
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().temporalObservations)).toBe(0);

  await page.locator("#sources-button").click();
  await expect(page.locator("#sources-dialog")).toBeVisible();
  await page.locator("#open-validation-origin").click();
  await expect(page.locator("#app")).toHaveAttribute("data-source", "validation");
  await expect(page.locator("#origin-status")).toHaveText("GROUND-TRUTH LAB / CONTINUUM STABLE");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().temporalObservations)).toBe(4);

  await page.locator("#reset-button").click();
  await expect(page.locator("#app")).toHaveAttribute("data-source", "reference");
  await expect(page).toHaveURL(/\/$/u);
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().temporalObservations)).toBe(0);
});

test("construction intake exposes every route and indexes ordinary files without rejecting them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator("#construct-button").click();
  await expect(page.locator("#intake-dialog")).toBeVisible();
  expectInsideViewport(await bounds(page, "#intake-dialog"));
  await expect(page.locator(".intake-routes")).toContainText("VERIFIED PLACE");
  await expect(page.locator(".intake-routes")).toContainText("TEMPORAL OBJECT");
  await expect(page.locator(".intake-routes")).toContainText("SOURCE GEOMETRY");
  await expect(page.locator(".intake-routes")).toContainText("SOURCE EVIDENCE");
  expect(await page.locator("#import-input").getAttribute("accept")).toBeNull();
  expect(await page.locator("#import-input").getAttribute("multiple")).not.toBeNull();

  await page.locator("#import-input").setInputFiles({
    name: "ordinary.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"purpose":"source evidence","version":1}'),
  });
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status))
    .toBe("indexed");
  await expect(page.locator("#app")).toHaveAttribute("data-source", "local-file");
  await expect(page.locator("#local-stage")).toBeVisible();
  await expect(page.locator("#local-name")).toHaveText("ordinary.json");
  await expect(page.locator("#local-kind")).toContainText("SOURCE FILE");
  await expect(page.locator("#local-root")).toContainText(/^sha256:/u);
  await page.locator("#local-close").click();

  await page.locator("#import-input").setInputFiles({
    name: "capture.png",
    mimeType: "image/png",
    buffer: Buffer.from("local-source-image-bytes"),
  });
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status))
    .toBe("indexed");
  await expect(page.locator("#local-kind")).toContainText("SOURCE IMAGE");
  await page.locator("#verify-button").click();
  await expect(page.locator("#verify-title")).toHaveText("LOCAL FILE INDEXED");
  await expect(page.locator("#verify-pha")).toHaveText("NOT ATTACHED");
  await page.locator("#verify-close").click();
  await page.locator("#local-close").click();

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([1, 2, 3, 4])], "dropped.bin", {
        type: "application/octet-stream",
      }),
    );
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
  });
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.name))
    .toBe("dropped.bin");
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.localImport?.status))
    .toBe("indexed");
});

test("renders GLB, GLTF, OBJ, PLY, and STL as local source geometry", async ({ page }) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);

  for (const artifact of sourceGeometryCases) {
    await page.locator("#import-input").setInputFiles(artifact);
    await expect(page.locator("#app")).toHaveAttribute("data-source", "source-geometry");
    await expect
      .poll(() => page.evaluate(() => window.__tessaryn?.sourceGeometry?.format))
      .toBe(artifact.format);
    const source = await page.evaluate(() => window.__tessaryn?.sourceGeometry);
    expect(source?.vertices).toBeGreaterThanOrEqual(3);
    expect(source?.streamRoot).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(source?.displayScale).toBeGreaterThan(0);
    await expect(page.locator("#local-stage")).toBeVisible();
    await expect(page.locator("#local-name")).toHaveText(artifact.name);
    await expect(page.locator("#local-kind")).toContainText("SOURCE GEOMETRY");
    await expect(page.locator("#origin-status")).toContainText("GEOMETRY STAGED");
    await page.locator("#verify-button").click();
    await expect(page.locator("#verify-title")).toHaveText("SOURCE GEOMETRY STAGED");
    await expect(page.locator("#verify-pha")).toHaveText("NOT ATTACHED");
    await page.locator("#verify-close").click();
    await page.locator("#local-close").click();
    await expect(page.locator("#app")).toHaveAttribute("data-source", "reference");
  }

  const externalGltf = JSON.parse(triangleGltf(false).toString("utf8")) as {
    buffers: Array<{ byteLength: number; uri?: string }>;
  };
  externalGltf.buffers[0]!.uri = "triangle.bin";
  await page.locator("#import-input").setInputFiles([
    {
      name: "external.gltf",
      mimeType: "model/gltf+json",
      buffer: Buffer.from(JSON.stringify(externalGltf)),
    },
    {
      name: "triangle.bin",
      mimeType: "application/octet-stream",
      buffer: triangleBytes(),
    },
  ]);
  await expect(page.locator("#app")).toHaveAttribute("data-source", "source-geometry");
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.sourceGeometry?.name))
    .toBe("external.gltf");
  await page.locator("#local-close").click();

  await page.locator("#import-input").setInputFiles(sourceGeometryCases[0]);
  await expect(page.locator("#app")).toHaveAttribute("data-source", "source-geometry");
  await expect(page.locator("#identity-state")).toContainText("SOURCE ROOT ONLY");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics())).toMatchObject({
    cellCount: 0,
    provenanceLinks: 0,
    temporalManifolds: 0,
    semanticConstellations: 0,
    activeMeaningFields: 0,
    assemblyPoints: 0,
    temporalObservations: 0,
    sdfVoxels: 0,
  });
  await page.waitForTimeout(500);
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
  expect(colors.size).toBeGreaterThan(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  expectInsideViewport(await bounds(page, "#local-stage"));
  expectInsideViewport(await bounds(page, "#local-close"));
  expectInsideViewport(await bounds(page, ".world-controls"));
  await expect(page.locator("#origin-status")).toHaveText(
    "GEOMETRY STAGED / WORLD CELL NOT ATTACHED",
  );
  const localStageBounds = await bounds(page, "#local-stage");
  const toastBounds = await bounds(page, "#toast");
  const toastIntersectsLocalStage =
    toastBounds.x < localStageBounds.right &&
    toastBounds.right > localStageBounds.x &&
    toastBounds.y < localStageBounds.bottom &&
    toastBounds.bottom > localStageBounds.y;
  expect(toastIntersectsLocalStage).toBe(false);
  const mobileScreenshot = await page.locator("#world-canvas").screenshot();
  const mobileImage = PNG.sync.read(mobileScreenshot);
  let mobileNonblack = 0;
  for (let index = 0; index < mobileImage.data.length; index += 4) {
    if (
      (mobileImage.data[index] ?? 0) > 10 ||
      (mobileImage.data[index + 1] ?? 0) > 10 ||
      (mobileImage.data[index + 2] ?? 0) > 10
    ) mobileNonblack += 1;
  }
  expect(mobileNonblack / (mobileImage.width * mobileImage.height)).toBeGreaterThan(0.08);
  expect(browserErrors).toEqual([]);
});

test("keeps malformed native and geometry failures visible in the intake", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://untrusted.invalid/")) remoteRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator("#import-input").setInputFiles({
    name: "broken.tessaryn",
    mimeType: "application/vnd.tessaryn.object",
    buffer: Buffer.alloc(80, 1),
  });
  await expect(page.locator("#intake-dialog")).toBeVisible();
  await expect(page.locator("#intake-state")).toHaveText("REJECTED");
  await expect(page.locator("#intake-detail")).toContainText("UNSUPPORTED CINEMATIC OBJECT MAGIC");
  expectInsideViewport(await bounds(page, "#intake-dialog"));
  expectInsideViewport(await bounds(page, "#intake-close"));
  await page.locator("#intake-close").click();

  await page.locator("#import-input").setInputFiles({
    name: "empty.obj",
    mimeType: "model/obj",
    buffer: Buffer.from("# no geometry\n"),
  });
  await expect(page.locator("#intake-dialog")).toBeVisible();
  await expect(page.locator("#intake-state")).toHaveText("REJECTED");
  await expect(page.locator("#intake-detail")).toContainText("NO RENDERABLE VERTICES");
  expectInsideViewport(await bounds(page, "#intake-dialog"));
  expectInsideViewport(await bounds(page, "#intake-close"));
  await page.locator("#intake-close").click();

  const networkGltf = JSON.parse(triangleGltf(false).toString("utf8")) as {
    buffers: Array<{ byteLength: number; uri?: string }>;
  };
  networkGltf.buffers[0]!.uri = "https://untrusted.invalid/geometry.bin";
  await page.locator("#import-input").setInputFiles({
    name: "network-dependent.gltf",
    mimeType: "model/gltf+json",
    buffer: Buffer.from(JSON.stringify(networkGltf)),
  });
  await expect(page.locator("#intake-dialog")).toBeVisible();
  await expect(page.locator("#intake-state")).toHaveText("REJECTED");
  await expect(page.locator("#intake-detail")).toContainText("NETWORK DEPENDENCY REJECTED");
  expect(remoteRequests).toEqual([]);
});

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
  expect(diagnostics?.cellCount).toBe(8);
  expect(diagnostics?.provenanceLinks).toBe(3);
  expect(diagnostics?.temporalManifolds).toBe(4);
  expect(diagnostics?.semanticConstellations).toBe(4);
  expect(diagnostics?.activeMeaningFields).toBeGreaterThan(0);
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

  await page.locator("#evidence-button").click();
  await expect(page.locator("#evidence-button")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().activeMeaningFields)).toBe(0);
  expect(await page.evaluate(() => window.__tessaryn?.verification?.errors)).toEqual([]);
});

test("constructs the public cinematic object without a video surface", async ({ page }) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCinematicObject(page);

  expect(await page.locator("video").count()).toBe(0);
  await expect(page.locator("#local-kind")).toHaveText(
    "PUBLIC OBJECT WEAVE / LOCALLY VERIFIED",
  );
  await expect(page.locator("#cinematic-controls")).toBeVisible();
  await expect(page.locator("#moment-rail button")).toHaveCount(4);
  await expect(page.locator("#cell-count")).toHaveText("72 WORLD CELLS");
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
    errors: [],
  });
  expect(verification?.verifiedMediaChunks).toBeGreaterThan(1);
  const diagnostics = await page.evaluate(() => window.__tessaryn?.scene.diagnostics());
  expect(diagnostics).toMatchObject({
    cellCount: 72,
    provenanceLinks: 71,
    temporalManifolds: 4,
    semanticConstellations: 5,
    activeMeaningFields: 5,
    assemblyPoints: 72,
    temporalObservations: 4,
    sdfVoxels: 0,
  });
  expect(diagnostics?.drawCalls).toBeLessThan(
    diagnostics?.visualProfile === "constrained" ? 60 : 120,
  );

  await page.locator("#verify-button").click();
  await expect(page.locator("#verify-title")).toHaveText("NATIVE TEMPORAL OBJECT ACCEPTED");
  await expect(page.locator("#verify-pha")).toHaveText("VALID");
  await expect(page.locator("#verify-detail")).toContainText("authored geometry");
  await page.locator("#verify-close").click();

  await page.locator("#cinematic-play").click();
  await expect(page.locator("#cinematic-play")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#cinematic-time").fill("750");
  await expect
    .poll(() => page.evaluate(() => window.__tessaryn?.scene.cinematicTime()))
    .toBeGreaterThan(0.74);
  await page.locator("#chronofold-button").click();
  await expect(page.locator("#chronofold-button")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#evidence-button").click();
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().activeMeaningFields)).toBe(0);

  await page.evaluate(() =>
    window.__tessaryn?.scene.selectCell("cinematic-nostalgia-continuum-monument-01"),
  );
  await expect(page.locator("#trace-title")).toHaveText("NOSTALGIA / CONTINUUM MONUMENT");
  await page.locator('[data-trace-tab="meaning"]').click();
  await expect(page.locator("#trace-summary")).toContainText("interlocked Tessaryn frames");
  await page.locator("#trace-close").click();

  await page.locator("#objects-button").click();
  await page.locator("#object-search").fill("nostalgia");
  await expect(page.locator(".object-entry")).toHaveCount(1);
  await expect(page.locator(".object-entry code")).toHaveText(
    "nostalgia-continuum-monument-01",
  );
  await page.locator("#objects-close").click();

  for (const selector of ["#local-stage", "#cinematic-controls", ".world-controls"]) {
    expectInsideViewport(await bounds(page, selector));
  }
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

test("mobile constructs the public temporal object with reachable controls", async ({ page }) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openCinematicObject(page);

  expect(await page.locator("video").count()).toBe(0);
  const diagnostics = await page.evaluate(() => window.__tessaryn?.scene.diagnostics());
  expect(diagnostics?.drawCalls).toBeLessThan(
    diagnostics?.visualProfile === "constrained" ? 55 : 120,
  );
  expect(diagnostics?.materializationMs).toBeLessThan(30_000);
  for (const selector of [
    "#local-stage",
    "#cinematic-controls",
    ".world-controls",
    "#chronofold-button",
    "#evidence-button",
  ]) {
    expectInsideViewport(await bounds(page, selector));
  }

  await page.locator("#verify-button").click();
  await expect(page.locator("#verify-title")).toHaveText("NATIVE TEMPORAL OBJECT ACCEPTED");
  expectInsideViewport(await bounds(page, "#verification-dialog"));
  expectInsideViewport(await bounds(page, "#verify-close"));
  await page.locator("#verify-close").click();

  await page.locator("#chronofold-button").click();
  await expect(page.locator("#chronofold-button")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#objects-button").click();
  expectInsideViewport(await bounds(page, "#objects-dialog"));
  expectInsideViewport(await bounds(page, "#objects-close"));
  await expect(page.locator(".object-entry")).toHaveCount(1);
  await page.locator("#objects-close").click();
  expect(browserErrors).toEqual([]);
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

test("imports and constructs a complete portable multi-moment Locus", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openOrigin(page);
  await page.locator("#import-input").setInputFiles(validationLocusArtifact);
  await expect(page.locator("#app")).toHaveAttribute("data-source", "imported-validation");
  await expect(page.locator("#verify-title")).toHaveText("GROUND-TRUTH LOCUS ACCEPTED");
  await expect(page.locator("#cell-count")).toHaveText("9 CELLS");
  await expect(page.locator("#local-kind")).toContainText("PORTABLE 4D LOCUS");
  await expect(page.locator("#moment-rail button")).toHaveCount(3);
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().temporalObservations)).toBe(4);
  await page.locator("#verify-close").click();
  await page.locator("#chronofold-button").click();
  expect(await page.evaluate(() => window.__tessaryn?.scene.diagnostics().chronofold)).toBe(true);
  await page.locator("#local-close").click();
  await expect(page.locator("#app")).toHaveAttribute("data-source", "reference");
});

test("publishes a real capture from the product and retains it in the Personal Weave", async ({
  page,
}) => {
  test.slow();
  const artifact = JSON.parse(await readFile(reconstructionArtifact, "utf8")) as {
    report: { sdf_cell_id: string };
    lineage: { rootprint: { root_branch: string } };
  };
  const errors: string[] = [];
  const uploaded = new Map<number, number>();
  let intent: Record<string, unknown> | undefined;
  let revocation: Record<string, unknown> | undefined;
  const cors = {
    "access-control-allow-origin": "http://127.0.0.1:4180",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,x-tessaryn-chunk-sha256",
  };
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.route("https://weave.test/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path === "/v1/catalog") {
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/public-object-catalog/v2",
          updated_at_unix_us: 0,
          objects: [],
        }),
      });
      return;
    }
    if (path === "/v1/policy") {
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/weave-node-policy/v1",
          chunk_bytes: 65_536,
          max_object_bytes: 536_870_912,
          max_publisher_bytes: 4_294_967_296,
          max_pending_bytes: 2_147_483_648,
          max_retained_bytes: 34_359_738_368,
          max_active_uploads: 32,
          max_active_uploads_per_publisher: 4,
          max_publications: 100_000,
          max_publications_per_publisher: 1_000,
          upload_ttl_seconds: 86_400,
          accepted_artifacts: ["tessaryn/reconstruction-artifact/v0"],
          immutable_content_identity: true,
          revocable_discovery: true,
        }),
      });
      return;
    }
    if (path === "/v1/uploads" && request.method() === "POST") {
      intent = request.postDataJSON() as Record<string, unknown>;
      const bytes = Number(intent.artifact_bytes);
      const chunkCount = Math.ceil(bytes / 65_536);
      await route.fulfill({
        status: 201,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/upload-session/v1",
          upload_id: `upl_${"1".repeat(64)}`,
          publisher_id: `key_${"2".repeat(64)}`,
          chunk_bytes: 65_536,
          chunk_count: chunkCount,
          intent,
        }),
      });
      return;
    }
    if (path === `/v1/uploads/upl_${"1".repeat(64)}` && request.method() === "GET") {
      const bytes = Number(intent?.artifact_bytes ?? 0);
      const chunkCount = Math.ceil(bytes / 65_536);
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          upload_id: `upl_${"1".repeat(64)}`,
          chunk_count: chunkCount,
          received_chunks: [],
          missing_chunks: Array.from({ length: chunkCount }, (_, index) => index),
          ready_to_commit: false,
        }),
      });
      return;
    }
    const chunkMatch = path.match(/\/chunks\/(\d+)$/u);
    if (chunkMatch && request.method() === "PUT") {
      uploaded.set(Number(chunkMatch[1]), request.postDataBuffer()?.byteLength ?? 0);
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          upload_id: `upl_${"1".repeat(64)}`,
          chunk_count: uploaded.size,
          received_chunks: [...uploaded.keys()],
          missing_chunks: [],
          ready_to_commit: true,
        }),
      });
      return;
    }
    if (path.endsWith("/commit") && request.method() === "POST" && intent) {
      await route.fulfill({
        status: 201,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/publication-receipt/v1",
          publication_id: `obj_${"3".repeat(64)}`,
          publisher_id: `key_${"2".repeat(64)}`,
          accepted_at_unix_us: 1_783_833_700_000_000,
          artifact_kind: "rgbd_reconstruction",
          artifact_url: `https://weave.test/v1/artifacts/${String(intent.artifact_sha256).slice(7)}`,
          cell_id: artifact.report.sdf_cell_id,
          rootprint_branch: artifact.lineage.rootprint.root_branch,
          moments: 1,
          dimensions: "REAL RGB-D / NATIVE 3D + TIME",
          media: "18 SURFELS / 90 SDF VOXELS",
          intent,
        }),
      });
      return;
    }
    if (path === "/v1/publications/revoke" && request.method() === "POST") {
      revocation = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify(revocation),
      });
      return;
    }
    await route.fulfill({ status: 404, headers: cors });
  });

  await page.goto("/?origin=validation&weaveApi=https%3A%2F%2Fweave.test");
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator("#import-input").setInputFiles(reconstructionArtifact);
  await expect(page.locator("#verify-title")).toHaveText("LOCAL CAPTURE ACCEPTED");
  await page.locator("#verify-close").click();
  await page.locator("#trace-close").click();
  await page.locator("#local-share").click();
  await expect(page.locator("#publish-dialog")).toBeVisible();
  await page.locator("#publish-object-id").fill("real-place-alpha");
  await page.locator("#publish-title").fill("Real Place Alpha");
  await page.locator("#publish-summary").fill("A real sensor place owned and published from its originating device.");
  await page.locator("#publish-consent").check();
  await page.locator("#publish-object").click();
  await expect(page.locator("#publish-stage")).toHaveText("PUBLIC WEAVE ACCEPTED", {
    timeout: 30_000,
  });
  expect(
    await page.evaluate(
      () =>
        new Promise<boolean>((resolve, reject) => {
          const request = indexedDB.open("tessaryn-personal-weave-v1", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const identity = database
              .transaction("identity", "readonly")
              .objectStore("identity")
              .get("publisher");
            identity.onerror = () => reject(identity.error);
            identity.onsuccess = () => {
              const extractable = Boolean(
                (identity.result as { privateKey?: CryptoKey } | undefined)?.privateKey?.extractable,
              );
              database.close();
              resolve(extractable);
            };
          };
        }),
    ),
  ).toBe(false);
  expect(uploaded.size).toBeGreaterThan(0);
  expect([...uploaded.values()].reduce((total, bytes) => total + bytes, 0)).toBe(
    (await readFile(reconstructionArtifact)).byteLength,
  );
  await page.locator("#publish-close").click();
  await page.locator("#objects-button").click();
  await page.locator("#object-search").fill("real-place-alpha");
  await expect(page.locator(".object-entry")).toHaveCount(1);
  await page.locator('[data-weave-scope="personal"]').click();
  await expect(page.locator(".personal-object-row")).toHaveCount(1);
  await expect(page.locator("#personal-weave-count")).toHaveText("1");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".personal-object-row .personal-unpublish").click();
  await expect.poll(() => revocation?.publication_id).toBe(`obj_${"3".repeat(64)}`);
  expect(revocation).toMatchObject({
    schema: "tessaryn/publication-revocation/v1",
    publication_id: `obj_${"3".repeat(64)}`,
  });
  expect(revocation?.signature).toMatch(/^[A-Za-z0-9+/]{86}$/u);
  await expect(page.locator(".personal-object-row .personal-unpublish")).toHaveCount(0);
  await page.locator(".personal-object-row .object-entry").click();
  await expect(page.locator("#verify-title")).toHaveText("LOCAL CAPTURE ACCEPTED");
  expect(errors).toEqual([]);
});

test("rejects an inconsistent node session before releasing artifact chunks", async ({ page }) => {
  let chunkRequests = 0;
  const cors = {
    "access-control-allow-origin": "http://127.0.0.1:4180",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,x-tessaryn-chunk-sha256",
  };
  await page.route("https://weave.test/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path === "/v1/catalog") {
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/public-object-catalog/v2",
          updated_at_unix_us: 0,
          objects: [],
        }),
      });
      return;
    }
    if (path === "/v1/policy") {
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/weave-node-policy/v1",
          chunk_bytes: 65_536,
          max_object_bytes: 536_870_912,
          max_publisher_bytes: 4_294_967_296,
          max_pending_bytes: 2_147_483_648,
          max_retained_bytes: 34_359_738_368,
          max_active_uploads: 32,
          max_active_uploads_per_publisher: 4,
          max_publications: 100_000,
          max_publications_per_publisher: 1_000,
          upload_ttl_seconds: 86_400,
          accepted_artifacts: ["tessaryn/reconstruction-artifact/v0"],
          immutable_content_identity: true,
          revocable_discovery: true,
        }),
      });
      return;
    }
    if (path === "/v1/uploads" && request.method() === "POST") {
      const intent = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          schema: "tessaryn/upload-session/v1",
          upload_id: `upl_${"1".repeat(64)}`,
          publisher_id: `key_${"2".repeat(64)}`,
          chunk_bytes: 65_536,
          chunk_count: 2,
          intent,
        }),
      });
      return;
    }
    if (path.includes("/chunks/")) chunkRequests += 1;
    await route.fulfill({ status: 404, headers: cors });
  });

  await page.goto("/?origin=validation&weaveApi=https%3A%2F%2Fweave.test");
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator("#import-input").setInputFiles(reconstructionArtifact);
  await expect(page.locator("#verify-title")).toHaveText("LOCAL CAPTURE ACCEPTED");
  await page.locator("#verify-close").click();
  await page.locator("#trace-close").click();
  await page.locator("#local-share").click();
  await page.locator("#publish-consent").check();
  await page.locator("#publish-object").click();
  await expect(page.locator("#publish-stage")).toHaveText("PUBLICATION REJECTED");
  await expect(page.locator("#publish-detail")).toContainText("INVALID UPLOAD SESSION");
  expect(chunkRequests).toBe(0);
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
  await page.locator("#local-share").click();
  await expect(page.locator("#publish-dialog")).toBeVisible();
  expectInsideViewport(await bounds(page, "#publish-dialog"));
  expectInsideViewport(await bounds(page, "#publish-close"));
  expectInsideViewport(await bounds(page, "#keep-object"));
  expectInsideViewport(await bounds(page, "#publish-object"));
  await page.locator("#publish-close").click();
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
