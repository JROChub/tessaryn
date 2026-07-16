import { expect, test } from "@playwright/test";

test("ordinary browser camera input enters the responsive v0.21 visual boundary", async ({ page }) => {
  const authorityRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/keyxym-v26\/(keyxym-v26\.(?:mjs|wasm))|browser-assurance/iu.test(request.url())) {
      authorityRequests.push(request.url());
    }
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });

  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "preview");
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-map-authority", "adapter-required");
  await expect(page.locator("html")).toHaveAttribute("data-eform-authority", "not-requested");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "visual-preview");
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-pipeline",
    "keyxym-v021-responsive-baseline",
  );
  await expect(page.locator("#backend-name")).toHaveText("KEYXYM V0.21 VISUAL BASELINE");
  await expect(page.locator("#adapter-name")).toHaveText("CAMERA RGB / NON-METRIC");
  await expect(page.locator("#gpu-badge")).toHaveText("VISUAL ONLY");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
  expect(authorityRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("a claimed adapter without executable spatial integration cannot open authority gates", async ({ page }) => {
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

  await page.route("**/assurance/tessaryn-browser-assurance-v1.wasm**", async (route) => {
    await route.fulfill({ status: 503, body: "assurance unavailable" });
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("preview");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
  await expect(page.locator("#rootprint")).toHaveText("UNSEALED");
});
