import { expect, test } from "@playwright/test";

const KEYXYM_SOURCE = "c94d4db57d1db89e96cb7fd860da2d4c1617f516";
const ASSURANCE_SOURCE = "ecfa0f6584f8890afd4a3a44b4aa972b2768a62e";

test("verified v0.26 worker authority and assurance instantiate before capture", async ({ page }) => {
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
    "keyxym-v26-reality-authority-1",
  );
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-version", "0.26.0");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-assurance", "verified");
  await expect(page.locator("html")).toHaveAttribute(
    "data-world-cell-assurance-source",
    ASSURANCE_SOURCE,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-world-cell-controller",
    "keyxym-v026-worker-v1",
  );

  await expect(page.locator("#backend-name")).toHaveText("KEYXYM V0.26 / REALITY");
  await expect(page.locator("#adapter-name")).toHaveText(KEYXYM_SOURCE.slice(0, 12).toUpperCase());
  await expect(page.locator("#gpu-badge")).toHaveText("WORKER WASM READY");
  await expect(page.locator("#compute-state")).toHaveText("KEYXYM V0.26");
  await expect(page.locator("#pose-state")).toHaveText("KEYXYM READY");
  await expect(page.locator("#cell-state")).toHaveText("WORLD CELL / READY / RELATIVE");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toHaveText("SEAL GATE");
  await expect(page.locator("#send-button")).toBeDisabled();

  await page.locator("#reset-button").click();
  await expect(page.locator("#pose-state")).toHaveText("KEYXYM READY");
  await expect(page.locator("#cell-state")).toHaveText("WORLD CELL / READY / RELATIVE");
  await expect(page.locator("#start-button")).toBeEnabled();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
