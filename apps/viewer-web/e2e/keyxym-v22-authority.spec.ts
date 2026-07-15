import { expect, test } from "@playwright/test";

test("verified Keyxym v0.22 dual-field authority instantiates before capture", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });

  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("verified");
  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-frontend"))
    .toBe("verified");
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyxym-commit",
    "3076c306126058c6e9b24d851681ae79a26b9b55",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyxym-frontend-commit",
    "7b12b87028deae1c4cfedb42c9939175811fca8d",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyxym-timestamp-abi",
    "legalized-i64-low-high",
  );
  await expect(page.locator("#backend-name")).toContainText("KEYXYM");
  await expect(page.locator("#backend-name")).toContainText("DUAL-FIELD");
  await expect(page.locator("#pose-state")).toHaveText("KEYXYM READY");
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();

  expect(pageErrors).toEqual([]);
});

test("browser assurance digest matches the Power House and eform vector", async ({ page }) => {
  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });
  const digest = await page.evaluate(async () => {
    const module = await import("/src/world-cell-assurance.ts");
    return module.worldCellEnvelopeDigest({
      artifactKind: "world-cell",
      canonicalDigest: "01".repeat(32),
      reconstructionReceipt: "02".repeat(32),
      runtimeCommitment: "03".repeat(32),
      calibrationCommitment: "04".repeat(32),
      sourceSetCommitment: "05".repeat(32),
      parentCommitment: "06".repeat(32),
      rootprintCommitment: "07".repeat(32),
      sequence: 9n,
      timestampNs: 1_723_456_789_123_456_789n,
      metricScale: true,
      sealed: true,
    });
  });
  expect(digest).toBe("4ca0f5704f67791a328481e1c4d45acf77432faf50ad36d5744935c96161e75a");
});
