import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { transformWithOxc } from "vite";

const rgbArchive = process.env.TESSARYN_TARTANAIR_RGB_ARCHIVE;
const candidateDirectory = process.env.TESSARYN_KEYXYM_CANDIDATE_DIR;
const expectedArchiveSha256 = "9bea5fca9d0cf50105c7d34583d4d5db06e3715ef708262b4dfad763d34b17da";
const captureIndices = Array.from({ length: 32 }, (_, index) => index);
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
  const frame = String(index).padStart(6, "0");
  return `ArchVizTinyHouseDay/Data_easy/P000/image_lcam_front/${frame}_lcam_front.png`;
}

test("source-exact Keyxym candidate reconstructs the pinned continuous RGB sequence", async ({ page }) => {
  test.skip(!rgbArchive || !candidateDirectory,
    "Set the pinned TartanAir archive and source-exact Keyxym candidate directory.");
  test.setTimeout(120_000);
  expect(await sha256File(rgbArchive!)).toBe(expectedArchiveSha256);

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
  await page.route("https://tartanair.validation/**", async (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(1));
    expect(captureIndices).toContain(index);
    const body = execFileSync("unzip", ["-p", rgbArchive!, archiveEntry(index)], {
      maxBuffer: 8 * 1024 * 1024,
    });
    await route.fulfill({ body, contentType: "image/png" });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async (indices) => {
    const candidateRuntimeUrl = "/candidate-runtime.mjs";
    const imported = await import(/* @vite-ignore */ candidateRuntimeUrl) as typeof import("../src/keyxym-v26-runtime");
    const runtime = await imported.KeyxymV26Runtime.load({
      moduleUrl: "/candidate-keyxym-v26.mjs",
      wasmUrl: "/candidate-keyxym-v26.wasm",
      maximumAnalysisWidth: 240,
      maximumAnalysisHeight: 240,
    });
    const canvas = new OffscreenCanvas(240, 240);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("candidate validation canvas unavailable");
    const observations: Array<Record<string, number | string | boolean>> = [];
    let maximumSurfels = 0;
    let maximumMatches = 0;
    let maximumInliers = 0;
    let maximumRevision = 0n;
    try {
      for (const index of indices) {
        const response = await fetch(`https://tartanair.validation/${index}`);
        const bitmap = await createImageBitmap(await response.blob());
        context.drawImage(bitmap, 0, 0, 240, 240);
        bitmap.close();
        const rgba = new Uint8Array(context.getImageData(0, 0, 240, 240).data.buffer.slice(0));
        const sourceCommitment = new Uint8Array(await crypto.subtle.digest("SHA-256", rgba));
        const focal = 240 / (2 * Math.tan(Math.PI / 6));
        const snapshot = runtime.ingest({
          timestampNs: BigInt(index + 1) * 100_000_000n,
          width: 240,
          height: 240,
          fx: focal,
          fy: focal,
          cx: 120,
          cy: 120,
          scaleMetersPerUnit: 1,
          metricScale: false,
          rgba,
          sourceCommitment,
        });
        const surfels = snapshot.geometry ? snapshot.geometry.length / imported.KEYXYM_V26_SURFEL_FLOATS : 0;
        maximumSurfels = Math.max(maximumSurfels, surfels);
        maximumMatches = Math.max(maximumMatches, snapshot.pose.matches);
        maximumInliers = Math.max(maximumInliers, snapshot.pose.inliers);
        maximumRevision = snapshot.geometryRevision > maximumRevision ? snapshot.geometryRevision : maximumRevision;
        if (index < 16 || index % 8 === 0 || snapshot.pose.recovered || surfels > 0) {
          observations.push({
            index,
            matches: snapshot.pose.matches,
            inliers: snapshot.pose.inliers,
            recovered: snapshot.pose.recovered,
            degenerate: snapshot.pose.degenerate,
            tracking: snapshot.pose.tracking,
            parallax: snapshot.pose.parallaxDegrees,
            rejectionMask: snapshot.authority.rejectionMask,
            surfels,
            revision: snapshot.geometryRevision.toString(),
          });
        }
      }
    } finally {
      runtime.destroy();
    }
    return {
      maximumSurfels,
      maximumMatches,
      maximumInliers,
      maximumRevision: maximumRevision.toString(),
      observations,
    };
  }, captureIndices);

  console.log("KEYXYM_CANDIDATE_RECONSTRUCTION", JSON.stringify(result));
  expect(result.maximumMatches).toBeGreaterThanOrEqual(12);
  expect(result.maximumInliers).toBeGreaterThanOrEqual(10);
  expect(result.maximumSurfels).toBeGreaterThanOrEqual(64);
  expect(Number(result.maximumRevision)).toBeGreaterThanOrEqual(3);
});
