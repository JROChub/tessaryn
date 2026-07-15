import { expect, test } from "@playwright/test";

test("synthetic camera frames reach the v0.26 worker and form authoritative geometry", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
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
    if (!context) throw new Error("synthetic camera canvas unavailable");
    const shifts = [0, 8, 16, 24, 32, 40];
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;

    const draw = (shift: number) => {
      const image = context.createImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const sourceX = x - shift;
          const checker = ((Math.trunc(sourceX / 5) ^ Math.trunc(y / 5)) & 1);
          const detail = ((sourceX * sourceX + y * y + sourceX * y) % 53 + 53) % 53;
          const value = checker ? 190 + detail % 50 : 25 + detail;
          const offset = (y * canvas.width + x) * 4;
          image.data[offset] = value;
          image.data[offset + 1] = Math.trunc(value * 3 / 4);
          image.data[offset + 2] = 255 - Math.trunc(value / 2);
          image.data[offset + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
    };

    const sendSequence = async () => {
      const writer = track.writable.getWriter();
      try {
        for (let index = 0; index < shifts.length; index += 1) {
          draw(shifts[index]!);
          const frame = new VideoFrame(canvas, {
            timestamp: (index + 1) * 180_000,
            duration: 180_000,
          });
          await writer.write(frame);
          frame.close();
          await new Promise((resolve) => window.setTimeout(resolve, 180));
        }
        for (let index = 0; index < 30; index += 1) {
          const frame = new VideoFrame(canvas, {
            timestamp: (shifts.length + index + 1) * 180_000,
            duration: 180_000,
          });
          await writer.write(frame);
          frame.close();
          await new Promise((resolve) => window.setTimeout(resolve, 180));
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
  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("verified");
  await page.locator("#start-button").click();

  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-forming-samples") ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator("#frame-count").textContent() ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(2);
  await expect.poll(async () => Number(await page.locator("html").getAttribute("data-authoritative-surfels") ?? 0), {
    timeout: 20_000,
  }).toBeGreaterThan(0);

  await expect(page.locator("html")).toHaveAttribute(
    "data-authority-stage",
    /tracking|moment-ready|seal-ready/,
  );
  await expect(page.locator("#dispatch-time")).toContainText("worker");
  await expect(page.locator("#stop-button")).toBeEnabled();
  await page.locator("#stop-button").click();
  await expect(page.locator("#start-button")).toBeEnabled();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});