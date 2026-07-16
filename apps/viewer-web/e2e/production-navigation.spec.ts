import { expect, test } from "@playwright/test";

test("the Origin exposes live World Cell visual odometry and same-origin release evidence", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const worldCell = page.locator("#world-cell-command");
  const release = page.locator("#release-attestation-command");
  await expect(worldCell).toBeVisible();
  await expect(worldCell).toHaveAttribute("href", "./world-cell-theater.html");
  await expect(release).toBeVisible();
  await expect(release).toHaveAttribute("href", "./release.json");
  await expect(release).toHaveAttribute("type", "application/json");

  const response = await page.request.get("/release.json");
  expect(response.ok()).toBe(true);
  const attestation = await response.json();
  expect(attestation.schema).toBe("tessaryn/deployment-attestation/v1");
  expect(attestation.product).toBe("TESSARYN Origin");
  expect(attestation.authority.keyxym.version).toBe("0.26.0");
  expect(attestation.authority.keyxym.source_exact).toBe(true);

  await worldCell.click();
  await expect(page).toHaveURL(/\/world-cell-theater\.html$/u);
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "preview");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "visual-preview");
  await expect(page.locator("html")).toHaveAttribute(
    "data-visual-pipeline",
    "tessaryn-visual-odometry-v1",
  );
  await expect(page.locator("html")).toHaveAttribute("data-authoritative-surfels", "0");
  await expect(page.locator("#backend-name")).toHaveText("TESSARYN VISUAL ODOMETRY V1");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
});
