import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const rgbArchive = process.env.TESSARYN_TARTANAIR_RGB_ARCHIVE;
const expectedArchiveSha256 = "9bea5fca9d0cf50105c7d34583d4d5db06e3715ef708262b4dfad763d34b17da";
const validationLocus = JSON.parse(readFileSync(
  new URL("../public/world/archviz-tiny-house-locus.json", import.meta.url),
  "utf8",
)) as {
  source: {
    profile: { id: string; source_class: string };
    selections: Array<{ source_indices: number[] }>;
  };
};
const sourceIndices = validationLocus.source.selections.flatMap((selection) => selection.source_indices);
const continuousCaptureIndices = Array.from({ length: 102 }, (_, index) => index);

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function archiveEntry(index: number): string {
  const frame = String(index).padStart(6, "0");
  return `ArchVizTinyHouseDay/Data_easy/P000/image_lcam_front/${frame}_lcam_front.png`;
}

test("provenance-bound TartanAir frames produce native Keyxym relative geometry", async ({ page }) => {
  test.skip(!rgbArchive, "Set TESSARYN_TARTANAIR_RGB_ARCHIVE to the exact pinned RGB archive.");
  test.setTimeout(120_000);
  expect(validationLocus.source.profile.id).toBe("tartanair-v2/archviz-tiny-house-day/easy/p000");
  expect(validationLocus.source.profile.source_class).toBe("synthetic_ground_truth");
  expect(sourceIndices).toHaveLength(48);
  expect(await sha256File(rgbArchive!)).toBe(expectedArchiveSha256);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("https://tartanair.validation/**", async (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(1));
    expect(continuousCaptureIndices).toContain(index);
    const body = execFileSync("unzip", ["-p", rgbArchive!, archiveEntry(index)], {
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
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("validation camera canvas unavailable");
    const track = new Generator({ kind: "video" });
    const stream = new MediaStream([track]);
    let sequenceStarted = false;

    const sendSequence = async (): Promise<void> => {
      const writer = track.writable.getWriter();
      let timestamp = 100_000;
      try {
        for (const index of indices) {
          const response = await fetch(`https://tartanair.validation/${index}`);
          const bitmap = await createImageBitmap(await response.blob());
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const frame = new VideoFrame(canvas, { timestamp, duration: 100_000 });
          timestamp += 100_000;
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
            void sendSequence().catch((error) => {
              document.documentElement.dataset.fixtureError = String(error);
            });
          }
          return stream;
        },
      },
    });
  }, { indices: continuousCaptureIndices });

  await page.goto("/world-cell-theater/", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative");
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await page.locator("#start-button").click();
  const observations: Array<Record<string, string | null>> = [];
  for (let index = 0; index < 40; index += 1) {
    await page.waitForTimeout(1_000);
    const observation = await page.locator("html").evaluate((node) => ({
        stage: node.dataset.authorityStage ?? null,
        rejectionMask: node.dataset.authorityRejectionMask ?? null,
        surfels: node.dataset.authoritativeSurfels ?? null,
        forming: node.dataset.formingSamples ?? null,
        revision: node.dataset.geometryRevision ?? null,
        fixtureError: node.dataset.fixtureError ?? null,
        pose: document.querySelector("#pose-state")?.textContent ?? null,
        tracking: document.querySelector("#tracking-value")?.textContent ?? null,
        parallax: document.querySelector("#parallax-value")?.textContent ?? null,
        error: document.querySelector("#error-value")?.textContent ?? null,
        confirmed: document.querySelector("#confirmed-value")?.textContent ?? null,
        rejected: document.querySelector("#rejected-value")?.textContent ?? null,
    }));
    observations.push(observation);
    if ((Number(observation.surfels ?? 0) >= 64 &&
         Number(observation.revision ?? 0) >= 3) || observation.fixtureError) break;
  }

  const result = await page.locator("html").evaluate((node) => ({
    mode: node.dataset.worldCellMode,
    authority: node.dataset.keyxymAuthority,
    stage: node.dataset.authorityStage,
    surfels: node.dataset.authoritativeSurfels,
    revision: node.dataset.geometryRevision,
    fixtureError: node.dataset.fixtureError,
  }));
  console.log("PROVENANCE_RECONSTRUCTION", JSON.stringify({ observations, result }));
  expect(result.mode).toBe("authoritative");
  expect(result.authority).toBe("verified");
  expect(Number(result.surfels ?? 0)).toBeGreaterThanOrEqual(64);
  expect(Number(result.revision ?? 0)).toBeGreaterThanOrEqual(3);
  expect(result.fixtureError).toBeUndefined();
  expect(pageErrors).toEqual([]);
});
