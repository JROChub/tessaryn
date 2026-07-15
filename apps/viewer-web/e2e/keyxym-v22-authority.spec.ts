import { expect, test } from "@playwright/test";

const KEYXYM_SOURCE = "700cb523ef9c1fb37733ffd1b1cbe0227be420c3";
const ASSURANCE_SOURCE = "ecfa0f6584f8890afd4a3a44b4aa972b2768a62e";

test("verified v0.22 authority and assurance instantiate before capture", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "networkidle" });

  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("verified");
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-source", KEYXYM_SOURCE);
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyxym-abi",
    "keyxym-v22-browser-dual-field-4",
  );
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-assurance", "verified");
  await expect(page.locator("html")).toHaveAttribute(
    "data-world-cell-assurance-source",
    ASSURANCE_SOURCE,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-world-cell-controller",
    "keyxym-consensus-v1",
  );

  await expect(page.locator("#backend-name")).toHaveText("KEYXYM V0.22 / DUAL FIELD");
  await expect(page.locator("#adapter-name")).toHaveText(KEYXYM_SOURCE.slice(0, 12).toUpperCase());
  await expect(page.locator("#gpu-badge")).toHaveText("WASM READY");
  await expect(page.locator("#compute-state")).toHaveText("KEYXYM");
  await expect(page.locator("#cell-state")).toHaveText("WORLD CELL / READY / RELATIVE");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toHaveText("SEAL CELL");
  await expect(page.locator("#send-button")).toBeDisabled();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
