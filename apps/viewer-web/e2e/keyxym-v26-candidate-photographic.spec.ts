import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { transformWithOxc } from "vite";
import type * as KeyxymRuntimeModule from "../src/keyxym-v26-runtime";

const archive = process.env.TESSARYN_MIDDLEBURY_TEMPLE_RING_ARCHIVE;
const candidateDirectory = process.env.TESSARYN_KEYXYM_CANDIDATE_DIR;
const expectedArchiveSha256 = "5f871fe96d25f510eac026c66c3a4c38229326260986e9926cba8a64e88c8359";
const captureIndices = Array.from({ length: 18 }, (_, index) => index + 1);
const runtimeModule = (await transformWithOxc(readFileSync(
  new URL("../src/keyxym-v26-runtime.ts", import.meta.url),
  "utf8",
), "keyxym-v26-runtime.ts")).code;

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function archiveEntry(index: number): string {
  return `templeRing/templeR${String(index).padStart(4, "0")}.png`;
}

test("source-exact Keyxym candidate sustains geometry on real photographic views", async ({ page }) => {
  test.skip(!archive || !candidateDirectory,
    "Set the official TempleRing archive and source-exact Keyxym candidate directory.");
  test.setTimeout(120_000);
  expect(await sha256File(archive!)).toBe(expectedArchiveSha256);

  await page.route("**/candidate-runtime.mjs", async (route) => {
    await route.fulfill({ body: runtimeModule, contentType: "application/javascript" });
  });
  await page.route("**/candidate-keyxym-v26.mjs", async (route) => {
    await route.fulfill({
      path: join(candidateDirectory!, "keyxym-v26.mjs"),
      contentType: "application/javascript",
    });
  });
  await page.route("**/candidate-keyxym-v26.wasm", async (route) => {
    await route.fulfill({
      path: join(candidateDirectory!, "keyxym-v26.wasm"),
      contentType: "application/wasm",
    });
  });
  await page.route("https://middlebury.validation/**", async (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(1));
    expect(captureIndices).toContain(index);
    const body = execFileSync("unzip", ["-p", archive!, archiveEntry(index)], {
      maxBuffer: 8 * 1024 * 1024,
    });
    await route.fulfill({ body, contentType: "image/png" });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async (indices) => {
    const runtimeUrl = "/candidate-runtime.mjs";
    const imported = await import(/* @vite-ignore */ runtimeUrl) as typeof KeyxymRuntimeModule;
    const runtime = await imported.KeyxymV26Runtime.load({
      moduleUrl: "/candidate-keyxym-v26.mjs",
      wasmUrl: "/candidate-keyxym-v26.wasm",
      maximumAnalysisWidth: 320,
      maximumAnalysisHeight: 240,
    });
    const canvas = new OffscreenCanvas(320, 240);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("photographic validation canvas unavailable");
    let timestamp = 0n;
    let maximumSurfels = 0;
    let currentSurfels = 0;
    let currentSurfaceVertices = 0;
    let maximumSurfaceVertices = 0;
    let maximumRevision = 0n;
    let maximumParallax = 0;
    let recoveredFrames = 0;
    let maximumConfirmed = 0;
    let momentReadyFrames = 0;
    let sealReadyFrames = 0;
    const observations: Array<Record<string, number | string | boolean>> = [];
    try {
      for (const index of indices) {
        const response = await fetch(`https://middlebury.validation/${index}`);
        const bitmap = await createImageBitmap(await response.blob());
        context.drawImage(bitmap, 0, 0, 320, 240);
        bitmap.close();
        const rgba = new Uint8Array(context.getImageData(0, 0, 320, 240).data.buffer.slice(0));
        const sourceCommitment = new Uint8Array(await crypto.subtle.digest("SHA-256", rgba));
        for (let repeat = 0; repeat < 1; repeat += 1) {
          timestamp += 100_000_000n;
          const focal = 320 / (2 * Math.tan(Math.PI / 6));
          const snapshot = runtime.ingest({
            timestampNs: timestamp,
            width: 320,
            height: 240,
            fx: focal,
            fy: focal,
            cx: 160,
            cy: 120,
            scaleMetersPerUnit: 1,
            metricScale: false,
            rgba,
            sourceCommitment,
          });
          if (snapshot.geometry) {
            currentSurfels = snapshot.geometry.length / imported.KEYXYM_V26_SURFEL_FLOATS;
          }
          if (snapshot.surface) {
            if (snapshot.surface.length % (imported.KEYXYM_V26_SURFACE_VERTEX_FLOATS * 3) !== 0) {
              throw new Error("candidate surface is not aligned to complete triangles");
            }
            currentSurfaceVertices = snapshot.surface.length / imported.KEYXYM_V26_SURFACE_VERTEX_FLOATS;
          }
          maximumSurfels = Math.max(maximumSurfels, currentSurfels);
          maximumSurfaceVertices = Math.max(maximumSurfaceVertices, currentSurfaceVertices);
          maximumRevision = snapshot.geometryRevision > maximumRevision
            ? snapshot.geometryRevision : maximumRevision;
          maximumParallax = Math.max(maximumParallax, snapshot.pose.parallaxDegrees);
          if (snapshot.pose.recovered) recoveredFrames += 1;
          maximumConfirmed = Math.max(maximumConfirmed, snapshot.quality.confirmed);
          if (snapshot.authority.momentAllowed) momentReadyFrames += 1;
          if (snapshot.authority.sealAllowed) sealReadyFrames += 1;
          if (repeat === 0 || snapshot.pose.recovered || snapshot.geometry) {
            observations.push({
              index,
              repeat,
              matches: snapshot.pose.matches,
              inliers: snapshot.pose.inliers,
              recovered: snapshot.pose.recovered,
              degenerate: snapshot.pose.degenerate,
              tracking: snapshot.pose.tracking,
              parallax: snapshot.pose.parallaxDegrees,
              rotation: snapshot.pose.rotationDegrees,
              observability: snapshot.pose.translationObservability,
              reprojection: snapshot.pose.reprojectionErrorPixels,
              rejectionMask: snapshot.authority.rejectionMask,
              authorityScore: snapshot.authority.score,
              continuity: snapshot.authority.continuityFrames,
              momentAllowed: snapshot.authority.momentAllowed,
              sealAllowed: snapshot.authority.sealAllowed,
              confirmed: snapshot.quality.confirmed,
              uncertain: snapshot.quality.uncertain,
              surfels: currentSurfels,
              surfaceVertices: currentSurfaceVertices,
              surfaceTriangles: currentSurfaceVertices / 3,
              revision: snapshot.geometryRevision.toString(),
            });
          }
        }
      }
    } finally {
      runtime.destroy();
    }
    return {
      maximumSurfels,
      terminalSurfels: currentSurfels,
      maximumSurfaceVertices,
      terminalSurfaceVertices: currentSurfaceVertices,
      maximumRevision: maximumRevision.toString(),
      maximumParallax,
      recoveredFrames,
      maximumConfirmed,
      momentReadyFrames,
      sealReadyFrames,
      observations,
    };
  }, captureIndices);

  console.log("KEYXYM_CANDIDATE_PHOTOGRAPHIC", JSON.stringify(result));
  expect(result.maximumParallax).toBeGreaterThanOrEqual(0.6);
  expect(result.recoveredFrames).toBeGreaterThanOrEqual(3);
  expect(result.maximumSurfels).toBeGreaterThanOrEqual(2_000);
  expect(result.terminalSurfels).toBeGreaterThanOrEqual(2_000);
  expect(result.maximumSurfaceVertices).toBeGreaterThanOrEqual(300);
  expect(result.terminalSurfaceVertices).toBeGreaterThanOrEqual(300);
  expect(result.maximumConfirmed).toBeGreaterThanOrEqual(512);
  expect(result.momentReadyFrames).toBeGreaterThanOrEqual(1);
  expect(result.sealReadyFrames).toBeGreaterThanOrEqual(1);
  expect(Number(result.maximumRevision)).toBeGreaterThanOrEqual(3);
});
