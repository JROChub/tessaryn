import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { transformWithOxc } from "vite";

const exportModule = (await transformWithOxc(readFileSync(
  new URL("../src/world-cell-export.ts", import.meta.url),
  "utf8",
), "world-cell-export.ts")).code;

test("a World Cell surface handoff opens directly in Origin", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  const id = await page.evaluate(async () => {
    const ply = [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "element face 1",
      "property list uchar int vertex_indices",
      "end_header",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "3 0 1 2",
      "",
    ].join("\n");
    const file = new File([ply], "world-cell-relative.ply", {
      type: "application/vnd.ply",
    });
    const id = "7a".repeat(32);
    await new Promise<void>((resolve, reject) => {
      const pending = indexedDB.open("tessaryn-origin-handoff-v1", 1);
      pending.onupgradeneeded = () => pending.result.createObjectStore("files", { keyPath: "id" });
      pending.onerror = () => reject(pending.error);
      pending.onsuccess = () => {
        const transaction = pending.result.transaction("files", "readwrite");
        transaction.objectStore("files").put({ id, file, createdAt: Date.now() });
        transaction.oncomplete = () => { pending.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    return id;
  });
  await page.goto(`/?open-local=${id}`);
  await expect(page.locator("#app")).toHaveAttribute("data-source", "source-geometry");
  await expect(page.locator("#local-name")).toHaveText("world-cell-relative.ply");
  await expect(page.locator("#origin-status")).toHaveText("GEOMETRY STAGED / WORLD CELL NOT ATTACHED");
  await expect(page).not.toHaveURL(/open-local=/u);
});

test("World Cell PLY export retains triangles and declares its scale", async ({ page }) => {
  await page.route("**/test-world-cell-export.mjs", (route) => route.fulfill({
    body: exportModule,
    contentType: "application/javascript",
  }));
  await page.goto("/world-cell-theater.html");
  const result = await page.evaluate(async () => {
    const exportUrl = "/test-world-cell-export.mjs";
    const { worldCellSurfacePly } = await import(
      /* @vite-ignore */ exportUrl
    ) as typeof import("../src/world-cell-export");
    const vertex = (x: number, y: number, z: number) => ({
      x, y, z, nx: 0, ny: 0, nz: 1, r: 0.2, g: 0.4, b: 0.8,
      confidence: 0.9, uncertainty: 0.1,
    });
    const blob = worldCellSurfacePly([vertex(0, 0, 0), vertex(1, 0, 0), vertex(0, 1, 0)], true);
    return {
      size: blob.size,
      header: await blob.slice(0, 512).text(),
    };
  });
  expect(result.size).toBeGreaterThan(100);
  expect(result.header).toContain("comment scale metric_meters");
  expect(result.header).toContain("element vertex 3");
  expect(result.header).toContain("element face 1");
});
