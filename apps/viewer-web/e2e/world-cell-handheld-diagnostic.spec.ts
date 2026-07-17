import { devices, expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

const fixtureDirectory = process.env.TESSARYN_HANDHELD_FRAME_DIR;
const targetUrl = process.env.TESSARYN_HANDHELD_TARGET_URL ?? "/world-cell-theater.html";
const rollingWindowRequired = process.env.TESSARYN_HANDHELD_REQUIRE_ROLLING === "true";
const { defaultBrowserType: _mobileBrowser, ...mobileDevice } = devices["iPhone 13"];
if (process.env.TESSARYN_HANDHELD_MOBILE === "true") test.use(mobileDevice);
const frameNames = fixtureDirectory ? readdirSync(fixtureDirectory)
  .filter((name) => /\.(?:jpe?g|png)$/iu.test(name))
  .sort()
  .map((name) => basename(name)) : [];

test("continuous handheld video produces relative geometry", async ({ page }) => {
  test.skip(!fixtureDirectory, "Set TESSARYN_HANDHELD_FRAME_DIR to extracted handheld RGB frames.");
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("https://handheld.fixture/**", async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    await route.fulfill({ path: join(fixtureDirectory!, name), contentType: "image/jpeg" });
  });
  const frameUrls = frameNames.map((name) => `https://handheld.fixture/${encodeURIComponent(name)}`);

  await page.addInitScript(({ frames }) => {
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
    if (!context) throw new Error("handheld camera canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;

    const sendSequence = async (): Promise<void> => {
      const writer = track.writable.getWriter();
      let timestamp = 100_000;
      try {
        for (const url of frames) {
          const response = await fetch(url);
          const bitmap = await createImageBitmap(await response.blob());
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const frame = new VideoFrame(canvas, { timestamp, duration: 33_333 });
          timestamp += 33_333;
          try {
            await writer.write(frame);
          } finally {
            frame.close();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 33));
        }
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
            void sendSequence().catch((error) => {
              document.documentElement.dataset.fixtureError = String(error);
            });
          }
          return stream;
        },
      },
    });
  }, { frames: frameUrls });

  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "ready");
  await page.locator("#start-button").click();
  const observations: Array<Record<string, string | null>> = [];
  for (let index = 0; index < 32; index += 1) {
    await page.waitForTimeout(1_000);
    observations.push(await page.locator("html").evaluate((node) => ({
      state: node.dataset.scanState ?? null,
      views: node.dataset.scanViews ?? null,
      acceptedViews: node.dataset.scanAcceptedViews ?? null,
      points: node.dataset.scanPoints ?? null,
      tracks: node.dataset.visualTracks ?? null,
      tracking: node.dataset.visualTracking ?? null,
      parallax: node.dataset.visualParallax ?? null,
      preview: node.dataset.scanPreviewStatus ?? null,
      previewReason: node.dataset.scanPreviewReason ?? null,
      fixtureError: node.dataset.fixtureError ?? null,
    })));
    const observation = observations.at(-1);
    const hasGeometry = Number(observation?.points ?? 0) >= 16;
    const exercisedRollingWindow = Number(observation?.acceptedViews ?? 0) > MAX_STATIC_VIEW_COUNT;
    if (hasGeometry && (!rollingWindowRequired || exercisedRollingWindow)) break;
  }
  console.log("HANDHELD_CAPTURE", JSON.stringify(observations));
  const views = Number(await page.locator("html").getAttribute("data-scan-views") ?? 0);
  expect(views).toBeGreaterThanOrEqual(6);
  if (rollingWindowRequired) {
    expect(Number(await page.locator("html").getAttribute("data-scan-accepted-views") ?? 0))
      .toBeGreaterThan(MAX_STATIC_VIEW_COUNT);
  }
  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "capturing");
  expect(Number(await page.locator("html").getAttribute("data-scan-points") ?? 0))
    .toBeGreaterThanOrEqual(16);
  await page.locator("#capture-button").click();
  await expect.poll(
    async () => await page.locator("html").getAttribute("data-scan-state"),
    { timeout: 40_000 },
  ).toMatch(/reconstructed|rejected/u);
  const result = await page.locator("html").evaluate((node) => ({
    state: node.dataset.scanState,
    result: node.dataset.scanResult,
    points: node.dataset.scanPoints,
    evidence: document.querySelector("#evidence-log")?.textContent,
  }));
  console.log("HANDHELD_RESULT", JSON.stringify(result));
  expect(result.state).toBe("reconstructed");
  expect(Number(result.points ?? 0)).toBeGreaterThanOrEqual(16);
  expect(pageErrors).toEqual([]);
});

const MAX_STATIC_VIEW_COUNT = 12;
