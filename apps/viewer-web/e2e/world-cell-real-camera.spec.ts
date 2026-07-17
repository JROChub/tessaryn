import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { expect, test } from "@playwright/test";

const archive = process.env.TESSARYN_MIDDLEBURY_TEMPLE_RING_ARCHIVE;
const expectedArchiveSha256 = "5f871fe96d25f510eac026c66c3a4c38229326260986e9926cba8a64e88c8359";
const captureIndices = Array.from({ length: 18 }, (_, index) => index + 1);

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function archiveEntry(index: number): string {
  return `templeRing/templeR${String(index).padStart(4, "0")}.png`;
}

test("official photographic views sustain authoritative World Cell geometry", async ({ page }, testInfo) => {
  test.skip(!archive, "Set the exact official Middlebury TempleRing archive.");
  test.setTimeout(120_000);
  expect(await sha256File(archive!)).toBe(expectedArchiveSha256);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("https://middlebury.validation/**", async (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(1));
    expect(captureIndices).toContain(index);
    const body = execFileSync("unzip", ["-p", archive!, archiveEntry(index)], {
      maxBuffer: 8 * 1024 * 1024,
    });
    await route.fulfill({ body, contentType: "image/png" });
  });

  await page.addInitScript(({ indices }) => {
    type GeneratedTrack = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
    type GeneratorConstructor = new (options: { kind: "video" }) => GeneratedTrack;
    const Generator = (globalThis as typeof globalThis & {
      MediaStreamTrackGenerator?: GeneratorConstructor;
    }).MediaStreamTrackGenerator;
    if (!Generator) throw new Error("MediaStreamTrackGenerator is unavailable");

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("photographic validation canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;

    const sendSequence = async (): Promise<void> => {
      const writer = track.writable.getWriter();
      let timestamp = 100_000;
      try {
        for (const index of indices) {
          const response = await fetch(`https://middlebury.validation/${index}`);
          const bitmap = await createImageBitmap(await response.blob());
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          for (let repeat = 0; repeat < 7; repeat += 1) {
            const frame = new VideoFrame(canvas, { timestamp, duration: 100_000 });
            timestamp += 100_000;
            try {
              await writer.write(frame);
            } finally {
              frame.close();
            }
            await new Promise((resolve) => window.setTimeout(resolve, 100));
          }
        }
        document.documentElement.dataset.fixtureDone = "true";
      } catch (error) {
        document.documentElement.dataset.fixtureError = String(error);
      } finally {
        writer.releaseLock();
      }
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (!sequenceStarted) {
            sequenceStarted = true;
            void sendSequence();
          }
          return stream;
        },
      },
    });
  }, { indices: captureIndices });

  await page.goto("/world-cell-theater/", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative");
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await page.locator("#start-button").click();

  let maximumSurfels = 0;
  let maximumRevision = 0;
  let maximumParallax = 0;
  let maximumConfirmed = 0;
  let observedMomentReady = false;
  let observedSealReady = false;
  let observedSealedRootprint = false;
  const observations: Array<Record<string, string | null>> = [];
  for (let sample = 0; sample < 80; sample += 1) {
    await page.waitForTimeout(250);
    const observation = await page.locator("html").evaluate((node) => ({
      surfels: node.dataset.authoritativeSurfels ?? null,
      revision: node.dataset.geometryRevision ?? null,
      done: node.dataset.fixtureDone ?? null,
      fixtureError: node.dataset.fixtureError ?? null,
      pose: document.querySelector("#pose-state")?.textContent ?? null,
      parallax: document.querySelector("#parallax-value")?.textContent ?? null,
      confirmed: document.querySelector("#confirmed-value")?.textContent ?? null,
      rootprint: document.querySelector("#rootprint")?.textContent ?? null,
      momentAllowed: node.dataset.momentAllowed ?? null,
      sealAllowed: node.dataset.sealAllowed ?? null,
      surfacePatches: node.dataset.surfacePatches ?? null,
      surfaceMode: node.dataset.surfaceMode ?? null,
      surfaceVertices: node.dataset.surfaceVertices ?? null,
      surfaceTriangles: node.dataset.surfaceTriangles ?? null,
      surfaceMaximumRadius: node.dataset.surfaceMaximumRadius ?? null,
      surfaceMaximumAngularRadius: node.dataset.surfaceMaximumAngularRadius ?? null,
      surfaceBuildMilliseconds: node.dataset.surfaceBuildMilliseconds ?? null,
    }));
    const surfels = Number(observation.surfels ?? 0);
    const revision = Number(observation.revision ?? 0);
    const parallax = Number.parseFloat(observation.parallax ?? "0");
    const confirmed = Number((observation.confirmed ?? "0").replaceAll(",", ""));
    maximumSurfels = Math.max(maximumSurfels, Number.isFinite(surfels) ? surfels : 0);
    maximumRevision = Math.max(maximumRevision, Number.isFinite(revision) ? revision : 0);
    maximumParallax = Math.max(maximumParallax, Number.isFinite(parallax) ? parallax : 0);
    maximumConfirmed = Math.max(maximumConfirmed, Number.isFinite(confirmed) ? confirmed : 0);
    observedMomentReady ||= observation.momentAllowed === "true";
    observedSealReady ||= observation.sealAllowed === "true";
    observedSealedRootprint ||= observation.rootprint !== null && observation.rootprint !== "UNSEALED";
    if (sample % 8 === 0 || surfels > maximumSurfels || observation.fixtureError) {
      observations.push(observation);
    }
    if (observation.done || observation.fixtureError) break;
  }
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-sealed", "true", { timeout: 15_000 });

  const terminal = await page.locator("html").evaluate((node) => ({
    surfels: Number(node.dataset.authoritativeSurfels ?? 0),
    revision: Number(node.dataset.geometryRevision ?? 0),
    done: node.dataset.fixtureDone,
    fixtureError: node.dataset.fixtureError,
    authority: node.dataset.keyxymAuthority,
    mode: node.dataset.worldCellMode,
    rootprint: document.querySelector("#rootprint")?.textContent,
    cellState: document.querySelector("#cell-state")?.textContent,
    everMomentReady: node.dataset.everMomentReady,
    everSealReady: node.dataset.everSealReady,
    sealed: node.dataset.worldCellSealed,
    surfacePatches: Number(node.dataset.surfacePatches ?? 0),
    surfaceMode: node.dataset.surfaceMode,
    surfaceVertices: Number(node.dataset.surfaceVertices ?? 0),
    surfaceTriangles: Number(node.dataset.surfaceTriangles ?? 0),
    surfaceMaximumRadius: Number(node.dataset.surfaceMaximumRadius ?? Number.POSITIVE_INFINITY),
    surfaceMaximumAngularRadius: Number(node.dataset.surfaceMaximumAngularRadius ?? Number.POSITIVE_INFINITY),
    surfaceBuildMilliseconds: Number(node.dataset.surfaceBuildMilliseconds ?? Number.POSITIVE_INFINITY),
  }));
  console.log("PHOTOGRAPHIC_WORLD_CELL", JSON.stringify({
    maximumSurfels, maximumRevision, maximumParallax, maximumConfirmed,
    observedMomentReady, observedSealReady, observedSealedRootprint,
    observations, terminal,
  }));
  const renderedFrame = await page.screenshot({
    path: testInfo.outputPath("authoritative-world-cell.png"),
    fullPage: true,
  });
  await testInfo.attach("authoritative-world-cell", { body: renderedFrame, contentType: "image/png" });

  expect(terminal.mode).toBe("authoritative");
  expect(terminal.authority).toBe("verified");
  expect(terminal.done).toBe("true");
  expect(terminal.fixtureError).toBeUndefined();
  expect(maximumParallax).toBeGreaterThanOrEqual(0.6);
  expect(maximumSurfels).toBeGreaterThanOrEqual(2_000);
  expect(maximumConfirmed).toBeGreaterThanOrEqual(512);
  expect(terminal.everMomentReady).toBe("true");
  expect(terminal.everSealReady).toBe("true");
  expect(terminal.sealed).toBe("true");
  expect(maximumRevision).toBeGreaterThanOrEqual(3);
  expect(terminal.surfels).toBeGreaterThanOrEqual(2_000);
  expect(terminal.revision).toBeGreaterThanOrEqual(3);
  expect(terminal.surfaceMode).toBe("relative-live-preview");
  expect(terminal.surfaceVertices).toBeGreaterThanOrEqual(300);
  expect(terminal.surfaceTriangles).toBeGreaterThanOrEqual(100);
  expect(terminal.surfaceMaximumRadius).toBe(0);
  expect(terminal.surfaceMaximumAngularRadius).toBe(0);
  expect(terminal.surfaceBuildMilliseconds).toBeLessThan(60);
  expect(await page.locator("#camera").evaluate((video) => Number.parseFloat(getComputedStyle(video).opacity))).toBeGreaterThanOrEqual(0.99);
  expect(await page.locator(".stage-panel").evaluate((stage) => stage.classList.contains("has-authoritative-surface"))).toBe(false);
  expect(terminal.rootprint).toMatch(/^[0-9A-F]{16}$/u);
  expect(pageErrors).toEqual([]);
});
