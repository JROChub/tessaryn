import { expect, test } from "@playwright/test";

test("synthetic multi-depth camera frames reach the v0.26 worker and form authoritative geometry", async ({ page }) => {
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

    const width = 320;
    const height = 240;
    const focal = width / (2 * Math.tan(Math.PI / 6));
    const depths = [1.6, 2.1, 2.8, 3.7] as const;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("synthetic camera canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
    let sequenceStarted = false;

    const hashByte = (x: number, y: number, channel: number): number => {
      let value = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^
        Math.imul(channel, 83_492_791)) >>> 0;
      value = Math.imul(value ^ (value >>> 16), 2_246_822_507) >>> 0;
      value = Math.imul(value ^ (value >>> 13), 3_266_489_909) >>> 0;
      return (value ^ (value >>> 16)) & 255;
    };

    const texture = (x: number, y: number, plane: number): [number, number, number] => {
      const checker = ((Math.floor(x / 11) + Math.floor(y / 9) + plane) & 1) ? 35 : -20;
      const dot = ((x % 29) - 14) ** 2 + ((y % 23) - 11) ** 2 < 12 ? 65 : 0;
      const base = (hashByte(Math.floor(x / 2), Math.floor(y / 2), plane) +
        hashByte(Math.floor(x / 4), Math.floor(y / 4), plane + 3)) / 2;
      const value = Math.max(5, Math.min(250, Math.round(base * 0.65 + 70 + checker + dot)));
      return [
        value,
        Math.round((value * 2 + hashByte(x, y, 8)) / 3),
        Math.round(255 - (value + hashByte(x, y, 9)) / 2),
      ];
    };

    const reference = (): ImageData => {
      const image = context.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const plane = Math.min(depths.length - 1, Math.floor(x / (width / depths.length)));
          const color = texture(x, y, plane);
          const offset = (y * width + x) * 4;
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
          image.data[offset + 3] = 255;
        }
      }
      return image;
    };

    const moved = (): ImageData => {
      const image = context.createImageData(width, height);
      const depthBuffer = new Float32Array(width * height);
      depthBuffer.fill(Number.POSITIVE_INFINITY);
      const angle = 0.8 * Math.PI / 180;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const translationX = 0.018;
      const translationY = 0.002;
      const translationZ = 0.003;

      for (let y = 2; y < height - 2; y += 1) {
        for (let x = 2; x < width - 2; x += 1) {
          const plane = Math.min(depths.length - 1, Math.floor(x / (width / depths.length)));
          const z = depths[plane]!;
          const worldX = (x - width / 2) * z / focal;
          const worldY = (y - height / 2) * z / focal;
          const currentX = cosine * worldX + sine * z + translationX;
          const currentY = worldY + translationY;
          const currentZ = -sine * worldX + cosine * z + translationZ;
          if (currentZ <= 0.1) continue;
          const targetX = Math.round(focal * currentX / currentZ + width / 2);
          const targetY = Math.round(focal * currentY / currentZ + height / 2);
          if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
          const target = targetY * width + targetX;
          if (currentZ >= depthBuffer[target]!) continue;
          depthBuffer[target] = currentZ;
          const color = texture(x, y, plane);
          const offset = target * 4;
          image.data[offset] = color[0];
          image.data[offset + 1] = color[1];
          image.data[offset + 2] = color[2];
          image.data[offset + 3] = 255;
        }
      }

      for (let pass = 0; pass < 3; pass += 1) {
        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            const offset = (y * width + x) * 4;
            if (image.data[offset] !== 0 || image.data[offset + 1] !== 0 || image.data[offset + 2] !== 0) continue;
            for (const [dx, dy] of neighbors) {
              const source = ((y + dy) * width + x + dx) * 4;
              if (image.data[source] === 0 && image.data[source + 1] === 0 && image.data[source + 2] === 0) continue;
              image.data[offset] = image.data[source]!;
              image.data[offset + 1] = image.data[source + 1]!;
              image.data[offset + 2] = image.data[source + 2]!;
              image.data[offset + 3] = 255;
              break;
            }
          }
        }
      }
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 3] === 0) {
          image.data[offset] = 18;
          image.data[offset + 1] = 23;
          image.data[offset + 2] = 31;
          image.data[offset + 3] = 255;
        }
      }
      return image;
    };

    const views = [reference(), moved()] as const;
    const writerClosed = (error: unknown): boolean =>
      track.readyState === "ended" ||
      (error instanceof Error && /stream closed|invalid state/iu.test(error.message));
    const sendSequence = async () => {
      const writer = track.writable.getWriter();
      try {
        for (let index = 0; index < 20; index += 1) {
          if (track.readyState === "ended") break;
          context.putImageData(views[index % views.length]!, 0, 0);
          const frame = new VideoFrame(canvas, {
            timestamp: (index + 1) * 180_000,
            duration: 180_000,
          });
          try {
            await writer.write(frame);
          } catch (error) {
            if (writerClosed(error)) break;
            throw error;
          } finally {
            frame.close();
          }
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
