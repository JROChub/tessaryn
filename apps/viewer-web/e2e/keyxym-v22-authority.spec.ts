import { expect, test } from "@playwright/test";

const KEYXYM_SOURCE = "c94d4db57d1db89e96cb7fd860da2d4c1617f516";
const KEYXYM_MODULE_SHA256 = "0d9f9921b01546051eacf7d0cf79f9b70e8b206dc455b833437fd992a737c7e5";
const KEYXYM_WASM_SHA256 = "89c66a4c8465ef8db10b6c40d4fdd3dc7d9c662d728cbd80d824a2ef27ea7d0e";
const ASSURANCE_SOURCE = "ecfa0f6584f8890afd4a3a44b4aa972b2768a62e";
const ASSURANCE_WASM_SHA256 = "74308022cd03f93ba5e73077f8a725c844cb1945290e5c8cd4a4f7ee99a8516b";

function resourceByPath(resources: string[], path: string): URL {
  const resource = resources
    .map((value) => new URL(value))
    .find((value) => value.pathname.endsWith(path) && value.searchParams.has("source"));
  if (!resource) throw new Error(`Authority resource was not content-addressed: ${path}`);
  return resource;
}

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

  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name));
  const keyxymModule = resourceByPath(resources, "/keyxym-v26/keyxym-v26.mjs");
  const keyxymWasm = resourceByPath(resources, "/keyxym-v26/keyxym-v26.wasm");
  const assuranceWasm = resourceByPath(
    resources,
    "/assurance/tessaryn-browser-assurance-v1.wasm",
  );
  expect(keyxymModule.searchParams.get("source")).toBe(KEYXYM_SOURCE);
  expect(keyxymModule.searchParams.get("sha256")).toBe(KEYXYM_MODULE_SHA256);
  expect(keyxymWasm.searchParams.get("source")).toBe(KEYXYM_SOURCE);
  expect(keyxymWasm.searchParams.get("sha256")).toBe(KEYXYM_WASM_SHA256);
  expect(assuranceWasm.searchParams.get("source")).toBe(ASSURANCE_SOURCE);
  expect(assuranceWasm.searchParams.get("sha256")).toBe(ASSURANCE_WASM_SHA256);

  await page.locator("#reset-button").click();
  await expect(page.locator("#pose-state")).toHaveText("KEYXYM READY");
  await expect(page.locator("#cell-state")).toHaveText("WORLD CELL / READY / RELATIVE");
  await expect(page.locator("#start-button")).toBeEnabled();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("browser assurance rejection disables the complete authority boundary", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const target = input instanceof Request ? input.url : input.toString();
      const url = new URL(target, window.location.href);
      if (url.pathname.endsWith("/assurance/tessaryn-browser-assurance-v1.wasm")) {
        return Promise.resolve(new Response("assurance unavailable", { status: 503 }));
      }
      return nativeFetch(input, init);
    };
  });

  await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.locator("html").getAttribute("data-keyxym-authority"))
    .toBe("rejected");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-assurance", "rejected");
  await expect(page.locator("#cell-state")).toHaveText("WORLD CELL / AUTHORITY REJECTED");
  await expect(page.locator("#start-button")).toBeDisabled();
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
});
