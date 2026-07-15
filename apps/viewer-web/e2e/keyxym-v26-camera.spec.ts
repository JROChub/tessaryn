import { expect, test } from "@playwright/test";

test("synthetic camera frames form the restored v0.21 visual point cloud", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    type GeneratedTrack = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
    type GeneratorConstructor = new (options: { kind: "video" }) => GeneratedTrack;
    const Generator = (globalThis as typeof globalThis & {
      MediaStreamTrackGenerator?: GeneratorConstructor;
    }).MediaStreamTrackGenerator;
    if (!Generator) throw new Error("MediaStreamTrackGenerator is unavailable");

    const width = 320;
    const height = 240;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("synthetic camera canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;

    const sendSequence = async () => {
      const writer = track.writable.getWriter();
      try {
        for (let frameIndex = 0; frameIndex < 18; frameIndex += 1) {
          const gradient = context.createLinearGradient(0, 0, width, height);
          gradient.addColorStop(0, `hsl(${String((frameIndex * 17) % 360)} 80% 48%)`);
          gradient.addColorStop(1, `hsl(${String((frameIndex * 17 + 150) % 360)} 75% 60%)`);
          context.fillStyle = gradient;
          context.fillRect(0, 0, width, height);
          context.fillStyle = "rgba(255,255,255,.88)";
          for (let y = 12; y < height; y += 24) {
            for (let x = 12; x < width; x += 24) {
              context.fillRect(x + frameIndex % 9, y, 7, 7);
            }
          }
          const frame = new VideoFrame(canvas, {
            timestamp: (frameIndex + 1) * 160_000,
            duration: 160_000,
          });
          await writer.write(frame);
          frame.close();
          await new Promise((resolve) => window.setTimeout(resolve, 160));
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
            void sendSequence();
          }
          return stream;
        },
      },
    });
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "v021");
  await page.locator("#start-button").click();

  await expect.poll(async () => Number(await page.locator("#frame-count").textContent() ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(2);
  await expect.poll(async () => Number(await page.locator("#surfel-count").textContent() ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(100);
  await expect(page.locator("#stop-button")).toBeEnabled();
  await expect(page.locator("#capture-button")).toBeEnabled();
  await page.locator("#stop-button").click();
  await expect(page.locator("#start-button")).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
