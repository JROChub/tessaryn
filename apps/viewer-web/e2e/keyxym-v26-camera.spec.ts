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
      const shift = (frame * 3) % 48;
      context.fillStyle = "#05080d";
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = -32; y < canvas.height + 32; y += 24) {
        for (let x = -64; x < canvas.width + 64; x += 24) {
          const sx = x + shift;
          const checker = ((Math.floor(x / 24) ^ Math.floor(y / 24)) & 1) === 0;
          context.fillStyle = checker
            ? `rgb(${180 + ((x + y + frame) % 70 + 70) % 70},110,220)`
            : `rgb(20,${60 + ((x * y + frame) % 90 + 90) % 90},100)`;
          context.fillRect(sx, y, 18, 18);
        }
      }
      context.strokeStyle = "white";
      context.lineWidth = 3;
      context.strokeRect(80 + shift, 70, 160, 120);
      context.strokeRect(340 + shift / 2, 240, 190, 140);
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
    /forming|tracking|moment-ready|seal-ready/,
  );
  await expect(page.locator("#dispatch-time")).toContainText("worker");
  await expect(page.locator("#stop-button")).toBeEnabled();
  await page.locator("#stop-button").click();
  await expect(page.locator("#start-button")).toBeEnabled();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
