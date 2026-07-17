import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("the canonical World Cell route initializes the provenance-gated Keyxym authority", async ({ page }) => {
  const authorityRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/keyxym-v26\/(keyxym-v26\.(?:mjs|wasm))|browser-assurance/iu.test(request.url())) {
      authorityRequests.push(request.url());
    }
  });

  await page.goto("/world-cell-theater/", { waitUntil: "networkidle" });

  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-map-authority", "verified");
  await expect(page.locator("html")).toHaveAttribute("data-eform-authority", "verified");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-controller", "keyxym-v026-worker-v1");
  await expect(page.locator("#backend-name")).toHaveText("KEYXYM V0.26 / REALITY");
  await expect(page.locator("#gpu-badge")).toHaveText("WORKER WASM READY");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#start-button")).toHaveText("START CAMERA");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
  expect(authorityRequests.some((url) => url.includes("keyxym-v26.mjs"))).toBe(true);
  expect(authorityRequests.some((url) => url.includes("keyxym-v26.wasm"))).toBe(true);
  expect(authorityRequests.some((url) => url.includes("browser-assurance"))).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("an unavailable Keyxym artifact cannot open authority gates", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as {
      tessarynMetricSensor: {
        currentCalibration(): Promise<unknown>;
        currentSpatialFrame(): Promise<unknown>;
      };
    }).tessarynMetricSensor = {
      currentCalibration: async () => ({ verified: false }),
      currentSpatialFrame: async () => null,
    };
  });

  await page.route("**/keyxym-v26/keyxym-v26.wasm**", async (route) => {
    await route.fulfill({ status: 503, body: "Keyxym authority unavailable" });
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("preview");
  await expect(page.locator("html")).toHaveAttribute("data-visual-pipeline", "tessaryn-world-cell-scan-v4");
  await expect(page.locator("html")).toHaveAttribute("data-visual-renderer", "world-cell-scan-v4");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
});
