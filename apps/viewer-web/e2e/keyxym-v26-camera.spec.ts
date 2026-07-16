import { expect, test } from "@playwright/test";

test("synthetic camera frames build measured visual odometry while authority stays locked", async ({ page }) => {
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

    const draw = (phase: number): void => {
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, `hsl(${(phase * 17) % 360} 70% 24%)`);
      gradient.addColorStop(1, `hsl(${(phase * 17 + 130) % 360} 80% 72%)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "rgba(245,245,245,0.95)";
      for (let y = 12; y < height; y += 24) {
        for (let x = 12; x < width; x += 24) {
          context.fillRect(x + (phase % 7), y + ((phase * 2) % 5), 8, 8);
        }
      }
      context.fillStyle = "rgba(10,18,30,0.9)";
      context.fillRect(40 + phase * 2, 55, 74, 112);
      context.fillRect(190 - phase, 90, 88, 54);
    };

    const sendSequence = async (): Promise<void> => {
      const writer = track.writable.getWriter();
      try {
        for (let index = 0; index < 30; index += 1) {
          draw(index);
          const frame = new VideoFrame(canvas, {
            timestamp: (index + 1) * 120_000,
            duration: 120_000,
          });
          try {
            await writer.write(frame);
          } finally {
            frame.close();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 120));
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
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "visual-preview");
  await expect(page.locator("html")).toHaveAttribute("data-visual-pipeline", "tessaryn-visual-odometry-v1");
  await page.locator("#start-button").click();

  await expect.poll(async () => Number(await page.locator("#frame-count").textContent() ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(6);
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-visual-points") ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(1_000);
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-visual-keyframes") ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(1);
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-visual-tracks") ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(5);
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-visual-tracking") ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(0.1);
  await expect(page.locator("#surfel-count")).toContainText("0 AUTH /");
  await expect(page.locator("#pose-state")).toContainText("VISUAL TRACK");
  await expect(page.locator("#capture-state")).toHaveText(/VISUAL MAPPING|FIND TEXTURE \/ MOVE SLOWLY/u);
  await expect(page.locator("#dispatch-time")).toContainText("TRACKS /");
  await expect(page.locator("#dispatch-time")).toContainText("° REL");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#stop-button")).toBeEnabled();

  await page.locator("#stop-button").click();
  await expect(page.locator("#start-button")).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
