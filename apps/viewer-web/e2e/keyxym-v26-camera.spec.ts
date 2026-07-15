import { expect, test } from "@playwright/test";

test("synthetic camera frames reach the v0.26 worker and form authoritative geometry", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("synthetic camera canvas unavailable");
    let frame = 0;
    const render = () => {
      const phase = Math.min(40, Math.floor(frame / 3));
      context.fillStyle = "#05080d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = -32; y < canvas.height + 32; y += 20) {
        for (let x = -80; x < canvas.width + 80; x += 20) {
          const sx = x + phase;
          const checker = ((Math.floor(x / 20) ^ Math.floor(y / 20)) & 1) === 0;
          const detail = ((x * x + y * y + x * y) % 53 + 53) % 53;
          context.fillStyle = checker
            ? `rgb(${185 + detail},${90 + detail / 2},220)`
            : `rgb(20,${55 + detail},${105 + detail / 2})`;
          context.fillRect(sx, y, 15, 15);
        }
      }
      context.strokeStyle = "white";
      context.lineWidth = 3;
      context.strokeRect(80 + phase, 70, 160, 120);
      context.strokeRect(340 + phase, 240, 190, 140);
      frame += 1;
      requestAnimationFrame(render);
    };
    render();
    const stream = canvas.captureStream(30);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => stream,
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