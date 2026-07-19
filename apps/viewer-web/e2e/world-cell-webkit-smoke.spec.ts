import { expect, test } from "@playwright/test";

test("iPhone WebKit initializes the provenance-gated Keyxym authority", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative", {
    timeout: 15_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-keyxym-authority", "verified");
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-controller", "keyxym-v026-worker-v1");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#start-button")).toHaveText("START CAMERA");
  await expect(page.locator("#stage-message b")).toHaveText("READY TO CAPTURE A PLACE");
  await expect(page.locator("#details-button")).toBeVisible();
  const captureDock = await page.locator(".capture-dock").boundingBox();
  const viewport = page.viewportSize();
  expect(captureDock).not.toBeNull();
  expect(captureDock?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((captureDock?.x ?? 0) + (captureDock?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0))
    .toBeGreaterThan(viewport?.height ?? 0);

  const builtResponse = await page.request.get("/world-cell-theater.html");
  expect(builtResponse.ok()).toBe(true);
  const builtHtml = await builtResponse.text();
  expect(builtHtml).not.toContain("world-cell-authority-entry.ts");
  expect(builtHtml).not.toMatch(/(?:src|href)=["']\/?src\//u);
  expect(builtHtml).toMatch(/assets\/.+\.js/u);
  expect(pageErrors).toEqual([]);
});

test("iPhone WebKit exposes a basic camera fallback when the release module fails", async ({ page }) => {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  const response = await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await page.evaluate(() => {
    (window as typeof window & { tessarynWorldCellBootFailure?: (reason: string) => void })
      .tessarynWorldCellBootFailure?.("The World Cell release module could not load.");
  });

  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "boot-recovery", {
    timeout: 15_000,
  });
  await expect(page.locator("#stage-message b")).toHaveText("WORLD CELL MODULE UNAVAILABLE");
  await expect(page.locator("#start-button")).toBeEnabled();
  await expect(page.locator("#start-button")).toHaveText("START BASIC CAMERA");
  await expect(page.locator("#capture-button")).toBeDisabled();
  await expect(page.locator("#seal-button")).toBeDisabled();
  await expect(page.locator("#send-button")).toBeDisabled();
});

test("small iPhone keeps Theater controls in one reachable scroll flow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/world-cell-theater.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-mode", "authoritative", {
    timeout: 15_000,
  });

  const initial = await page.evaluate(() => {
    const stage = document.querySelector(".stage-viewport")?.getBoundingClientRect();
    const capture = document.querySelector(".capture-dock")?.getBoundingClientRect();
    return {
      scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      stageBottom: stage?.bottom ?? 0,
      captureTop: capture?.top ?? 0,
      captureLeft: capture?.left ?? -1,
      captureRight: capture?.right ?? innerWidth + 1,
    };
  });
  expect(initial.scrollHeight).toBeGreaterThan(initial.viewportHeight);
  expect(initial.bodyOverflowY).not.toBe("hidden");
  expect(initial.captureTop).toBeGreaterThanOrEqual(initial.stageBottom);
  expect(initial.captureLeft).toBeGreaterThanOrEqual(0);
  expect(initial.captureRight).toBeLessThanOrEqual(initial.viewportWidth);

  await page.locator("#advanced-button").click();
  await page.locator("#sensor-button").scrollIntoViewIfNeeded();
  await expect(page.locator("#sensor-button")).toBeInViewport();
  await expect(page.locator("#calibrate-button")).toBeInViewport();

  await page.evaluate(() => {
    const timeline = document.querySelector("#timeline");
    if (timeline) timeline.innerHTML = '<button class="active"><small>MOMENT 00</small><b>1,024 CONFIRMED</b></button>';
    for (const id of ["open-model-button", "download-model-button"]) {
      document.getElementById(id)?.removeAttribute("disabled");
    }
  });
  await page.locator("#open-model-button").scrollIntoViewIfNeeded();
  for (const id of ["seal-button", "open-model-button", "download-model-button", "export-cell-button"]) {
    const bounds = await page.locator(`#${id}`).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  }

  await page.locator("#details-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-details-open", "true");
  const drawerScrollable = await page.locator(".instrument-stack").evaluate((drawer) => {
    drawer.scrollTop = drawer.scrollHeight;
    return drawer.scrollHeight > drawer.clientHeight;
  });
  expect(drawerScrollable).toBe(true);
  await expect(page.locator("#details-close")).toBeInViewport();
  await page.locator("#details-close").click();

  await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0));
  const clearance = await page.evaluate(() => {
    const stage = document.querySelector(".stage-panel")?.getBoundingClientRect();
    const footer = document.querySelector(".theater-controls")?.getBoundingClientRect();
    return { stageBottom: stage?.bottom ?? 0, footerTop: footer?.top ?? innerHeight };
  });
  expect(clearance.stageBottom).toBeLessThanOrEqual(clearance.footerTop);
});
