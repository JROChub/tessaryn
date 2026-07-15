import { expect, test } from "@playwright/test";

test("restored v0.21 theater loads its complete visual boundary before capture", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });

  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "v021");
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-version", "0.21");
  await expect(page.locator("#backend-name")).toHaveText(/KEYXYM MAPS V0\.21|CPU REFERENCE/u);
  await expect(page.locator("#capture-state")).toHaveText("READY");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();

  const stage = page.locator(".stage-panel");
  await expect(stage).toBeVisible();
  expect((await stage.boundingBox())?.height ?? 0).toBeGreaterThan(250);
  expect(pageErrors).toEqual([]);
});

test("v0.21 boot does not request the inactive v0.26 authority bundle", async ({ page }) => {
  const authorityRequests: string[] = [];
  page.on("request", (request) => {
    if (/keyxym-v26|browser-assurance/iu.test(request.url())) authorityRequests.push(request.url());
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "v021");
  expect(authorityRequests).toEqual([]);
});
