import { expect, test } from "@playwright/test";

test("synchronized calibrated RGB-D forms a sealed inhabitable metric continuum", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    type GeneratedTrack = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
    type GeneratorConstructor = new (options: { kind: "video" }) => GeneratedTrack;
    const Generator = (globalThis as typeof globalThis & {
      MediaStreamTrackGenerator?: GeneratorConstructor;
    }).MediaStreamTrackGenerator;
    if (!Generator) throw new Error("MediaStreamTrackGenerator is unavailable");

    const width = 640;
    const height = 480;
    const fx = 520;
    const fy = 520;
    const cx = 319.5;
    const cy = 239.5;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("spatial validation canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;
    let currentDepth = new Float32Array(width * height).fill(3.4);
    let currentPose = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    const renderRoom = (translationX: number): {
      rgba: Uint8ClampedArray<ArrayBuffer>;
      depth: Float32Array<ArrayBuffer>;
    } => {
      const rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
      const depth = new Float32Array(new ArrayBuffer(width * height * 4));
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const rayX = (x - cx) / fx;
        const rayY = (y - cy) / fy;
        let z = 3.4;
        let surface = 0;
        if (rayY > 0.02) {
          const floorZ = 1.15 / rayY;
          if (floorZ > 0.08 && floorZ < z) { z = floorZ; surface = 1; }
        }
        if (rayX > 0.02) {
          const rightZ = (2.0 - translationX) / rayX;
          if (rightZ > 0.08 && rightZ < z) { z = rightZ; surface = 2; }
        } else if (rayX < -0.02) {
          const leftZ = (-2.0 - translationX) / rayX;
          if (leftZ > 0.08 && leftZ < z) { z = leftZ; surface = 2; }
        }
        const worldX = translationX + rayX * z;
        const worldY = rayY * z;
        const worldZ = z;
        let red = 0;
        let green = 0;
        let blue = 0;
        if (surface === 0) {
          const door = Math.abs(worldX) < 0.52 && worldY > -0.15 && worldY < 1.02;
          const windowBand = worldY > -0.68 && worldY < -0.28 && Math.abs(worldX) > 0.72;
          const mortar = Math.abs((worldX + 2.4) % 0.34) < 0.025 || Math.abs((worldY + 1.4) % 0.24) < 0.025;
          red = door ? 62 : windowBand ? 88 : mortar ? 92 : 174;
          green = door ? 42 : windowBand ? 166 : mortar ? 104 : 143;
          blue = door ? 32 : windowBand ? 218 : mortar ? 112 : 106;
        } else if (surface === 1) {
          const grid = Math.abs((worldX + 8) % 0.32) < 0.025 || Math.abs(worldZ % 0.32) < 0.025;
          red = grid ? 44 : 122;
          green = grid ? 50 : 104;
          blue = grid ? 58 : 82;
        } else {
          const bands = Math.abs((worldZ + worldY) % 0.28) < 0.035;
          red = bands ? 78 : 137;
          green = bands ? 91 : 126;
          blue = bands ? 106 : 116;
        }
        const pixel = y * width + x;
        const offset = pixel * 4;
        rgba[offset] = red;
        rgba[offset + 1] = green;
        rgba[offset + 2] = blue;
        rgba[offset + 3] = 255;
        depth[pixel] = z;
      }
      return { rgba, depth };
    };

    const sendSequence = async (): Promise<void> => {
      const writer = track.writable.getWriter();
      let timestamp = 100_000;
      try {
        const trajectory = [0, 0, 0.07, 0.14, 0.21, 0.28, 0.35];
        for (const translationX of trajectory) {
          const rendered = renderRoom(translationX);
          currentDepth = rendered.depth;
          currentPose = new Float32Array([1, 0, 0, translationX, 0, 1, 0, 0,
            0, 0, 1, 0, 0, 0, 0, 1]);
          context.putImageData(new ImageData(rendered.rgba, width, height), 0, 0);
          for (let repeat = 0; repeat < 5; repeat += 1) {
            const frame = new VideoFrame(canvas, { timestamp, duration: 100_000 });
            timestamp += 100_000;
            try { await writer.write(frame); } finally { frame.close(); }
            await new Promise((resolve) => window.setTimeout(resolve, 120));
          }
        }
        document.documentElement.dataset.fixtureDone = "true";
      } catch (error) {
        document.documentElement.dataset.fixtureError = String(error);
      } finally {
        writer.releaseLock();
      }
    };

    Object.defineProperty(window, "tessarynSpatialSensor", {
      configurable: true,
      value: {
        currentCalibration: async () => ({
          schema: "tessaryn/spatial-calibration/v1",
          verified: true,
          device: "deterministic-rgbd-room",
          receipt: "fe4acc92c7b92015f8d0e19ebcfaaef98c1ae5886dab2ce8ed8ec28c632d86c6",
          depthUnit: "meters-f32",
          poseConvention: "row-major-world-from-camera",
          synchronizedColorDepth: true,
          intrinsics: { width, height, fx, fy, cx, cy },
        }),
        captureFrame: async ({ timestampNs, colorMediaTimeSeconds, presentedFrames }: {
          timestampNs: string;
          colorMediaTimeSeconds: number;
          presentedFrames: number;
        }) => ({
          timestampNs,
          colorMediaTimeSeconds,
          presentedFrames,
          width,
          height,
          depthMeters: new Float32Array(currentDepth),
          worldFromCamera: new Float32Array(currentPose),
        }),
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (!sequenceStarted) { sequenceStarted = true; void sendSequence(); }
          return stream;
        },
      },
    });
  });

  await page.goto("/world-cell-theater/", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await page.locator("#start-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-fixture-done", "true", { timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-sealed", "true", { timeout: 20_000 });

  const terminal = await page.locator("html").evaluate((node) => ({
    metric: document.querySelector("#scale-value")?.textContent,
    surfels: Number(node.dataset.authoritativeSurfels ?? 0),
    revision: Number(node.dataset.geometryRevision ?? 0),
    surfaceMode: node.dataset.surfaceMode,
    surfaceVertices: Number(node.dataset.surfaceVertices ?? 0),
    surfaceTriangles: Number(node.dataset.surfaceTriangles ?? 0),
    fixtureError: node.dataset.fixtureError,
    sealed: node.dataset.worldCellSealed,
    everMomentReady: node.dataset.everMomentReady,
    everSealReady: node.dataset.everSealReady,
  }));
  console.log("CALIBRATED_SPATIAL_WORLD_CELL", JSON.stringify(terminal));
  const renderedFrame = await page.screenshot({
    path: testInfo.outputPath("calibrated-spatial-continuum.png"),
    fullPage: true,
  });
  await testInfo.attach("calibrated-spatial-continuum", {
    body: renderedFrame,
    contentType: "image/png",
  });
  const initialViewerPosition = await page.locator("html").getAttribute("data-viewer-position");
  await page.locator("#stage").focus();
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyA");
  await expect.poll(async () => page.locator("html").getAttribute("data-viewer-position"))
    .not.toBe(initialViewerPosition);

  expect(terminal.fixtureError).toBeUndefined();
  expect(terminal.metric).toBe("METRIC");
  expect(terminal.surfels).toBeGreaterThanOrEqual(2_000);
  expect(terminal.revision).toBeGreaterThanOrEqual(5);
  expect(terminal.surfaceMode).toBe("native-triangles");
  expect(terminal.surfaceVertices).toBeGreaterThanOrEqual(20_000);
  expect(terminal.surfaceTriangles).toBeGreaterThanOrEqual(6_000);
  expect(terminal.everMomentReady).toBe("true");
  expect(terminal.everSealReady).toBe("true");
  expect(terminal.sealed).toBe("true");
  expect(pageErrors).toEqual([]);
});
