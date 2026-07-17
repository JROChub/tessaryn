import { expect, test } from "@playwright/test";

test("pure camera rotation is rejected instead of producing fake geometry", async ({ page }) => {
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
    let seed = 11;
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
      const yaw = phase * 0.007;
      const cosine = Math.cos(yaw);
      const sine = Math.sin(yaw);
      for (const point of points) {
        const cameraX = cosine * point.x + sine * point.z;
        const cameraZ = -sine * point.x + cosine * point.z;
        const x = Math.round(focal * cameraX / cameraZ + width / 2);
        const y = Math.round(focal * point.y / cameraZ + height / 2);
        if (x < 5 || y < 5 || x >= width - 5 || y >= height - 5) continue;
        const red = point.value;
        const green = (point.value * 3 + point.size * 17) % 256;
        const blue = 255 - point.value;
        context.fillStyle = `rgb(${red} ${green} ${blue})`;
        context.fillRect(x - point.size, y - point.size, point.size * 2 + 1, point.size * 2 + 1);
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
  await expect(page.locator("html")).toHaveAttribute("data-visual-renderer", "world-cell-scan-v4");
  await page.locator("#start-button").click();

  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-scan-views") ?? 0), {
    timeout: 25_000,
  }).toBeGreaterThanOrEqual(6);
  await page.locator("#capture-button").click();

  await expect(page.locator("html")).toHaveAttribute("data-scan-state", "rejected", {
    timeout: 30_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-scan-result", "no-geometry");
  await expect(page.locator("html")).toHaveAttribute("data-scan-points", "0");
  await expect(page.locator("#stage-message b")).toHaveText("NO DEFENSIBLE GEOMETRY");
  await expect(page.locator("#surfel-count")).toHaveText("0 AUTH / 0 REL PTS");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
  expect(pageErrors).toEqual([]);
});
