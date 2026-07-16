import { expect, test } from "@playwright/test";

test("synthetic translated views produce accepted relative geometry while authority stays locked", async ({ page }) => {
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
    const focal = width * 0.9;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("synthetic camera canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const points = Array.from({ length: 180 }, (_, index) => ({
      x: (random() - 0.5) * 4.2,
      y: (random() - 0.5) * 3.1,
      z: 3 + random() * 4.8,
      value: 48 + Math.floor(random() * 198),
      size: 1 + index % 3,
    }));

    const draw = (phase: number): void => {
      context.fillStyle = "rgb(13 19 27)";
      context.fillRect(0, 0, width, height);
      const translation = phase * 0.022;
      const yaw = phase * 0.002;
      const cosine = Math.cos(yaw);
      const sine = Math.sin(yaw);
      for (const point of points) {
        const translatedX = point.x - translation;
        const cameraX = cosine * translatedX + sine * point.z;
        const cameraZ = -sine * translatedX + cosine * point.z;
        const x = Math.round(focal * cameraX / cameraZ + width / 2);
        const y = Math.round(focal * point.y / cameraZ + height / 2);
        if (x < 5 || y < 5 || x >= width - 5 || y >= height - 5) continue;
        const red = point.value;
        const green = (point.value * 3 + point.size * 17) % 256;
        const blue = 255 - point.value;
        context.fillStyle = `rgb(${red} ${green} ${blue})`;
        context.fillRect(x - point.size, y - point.size, point.size * 2 + 1, point.size * 2 + 1);
        context.fillStyle = `rgb(${255 - red} ${blue} ${green})`;
        context.fillRect(x, y, 1, 1);
      }
    };

    const sendSequence = async (): Promise<void> => {
      const writer = track.writable.getWriter();
      try {
        for (let index = 0; index < 80; index += 1) {
          draw(index);
          const frame = new VideoFrame(canvas, {
            timestamp: (index + 1) * 100_000,
            duration: 100_000,
          });
          try {
            await writer.write(frame);
          } finally {
            frame.close();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 100));
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
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "visual-preview");
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-pipeline",
    "tessaryn-world-cell-scan-v4",
  );
  await expect(page.locator("html")).toHaveAttribute("data-visual-renderer", "world-cell-scan-v4");
  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "ready");
  await page.locator("#start-button").click();

  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-scan-views") ?? 0), {
    timeout: 25_000,
  }).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#capture-button")).toBeEnabled();
  await expect(page.locator("#camera")).toHaveCSS("opacity", "1");
  await page.locator("#capture-button").click();

  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "reconstructed", {
    timeout: 30_000,
  });
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-scan-points") ?? 0), {
    timeout: 10_000,
  }).toBeGreaterThanOrEqual(16);
  await expect(page.locator("html")).toHaveAttribute(
    "data-scan-result",
    "relative-sparse-reconstruction",
  );
  await expect(page.locator("#surfel-count")).toContainText("0 AUTH /");
  await expect(page.locator("#surfel-count")).toContainText("REL PTS");
  await expect(page.locator("#pose-state")).toHaveText("RELATIVE SOLVE");
  await expect(page.locator("#capture-state")).toHaveText("RELATIVE SCAN COMPLETE");
  await expect(page.locator("#backend-name")).toHaveText("TESSARYN TWO-VIEW SFM V4");
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#start-button")).toHaveText("NEW SCAN");
  expect(pageErrors).toEqual([]);
});
