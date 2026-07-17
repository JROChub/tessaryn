import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixtureDirectory = process.env.TESSARYN_REAL_CAMERA_FIXTURE_DIR;
const frameUrls = fixtureDirectory ? Array.from({ length: 18 }, (_, index) => {
  const number = String(index + 1).padStart(4, "0");
  const bytes = readFileSync(join(fixtureDirectory, `templeR${number}.png`));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}) : [];

test("real photographic multiview frames produce relative geometry", async ({ page }) => {
  test.skip(
    !fixtureDirectory,
    "Set TESSARYN_REAL_CAMERA_FIXTURE_DIR to a local Middlebury templeRing dataset.",
  );
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

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
    if (!context) throw new Error("real camera canvas unavailable");
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
            void sendSequence().catch(() => undefined);
          }
          return stream;
        },
      },
    });
  }, { frames: frameUrls });

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "ready");
  await page.locator("#start-button").click();
  await expect.poll(
    async () => Number(await page.locator("html").getAttribute("data-scan-views") ?? 0),
    { timeout: 30_000 },
  ).toBeGreaterThanOrEqual(12);
  await page.locator("#capture-button").click();

  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "reconstructed", {
    timeout: 40_000,
  });
  await expect.poll(
    async () => Number(await page.locator("html").getAttribute("data-scan-points") ?? 0),
    { timeout: 10_000 },
  ).toBeGreaterThanOrEqual(16);
  await expect(page.locator("html")).toHaveAttribute(
    "data-scan-result",
    "relative-sparse-reconstruction",
  );
  await expect(page.locator("#surfel-count")).toContainText("REL PTS");
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
  await expect(page.locator("#seal-button")).toBeDisabled();
  expect(pageErrors).toEqual([]);
});
