import { expect, test } from "@playwright/test";

test("verified Keyxym v0.22 authority instantiates before capture", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });

  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("verified");
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyxym-commit",
    "3076c306126058c6e9b24d851681ae79a26b9b55",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyxym-timestamp-abi",
    "legalized-i64-low-high",
  );
  await expect(page.locator("#backend-name")).toContainText("KEYXYM V0.22");
  await expect(page.locator("#pose-state")).toHaveText("KEYXYM READY");
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();

  expect(pageErrors).toEqual([]);
});
