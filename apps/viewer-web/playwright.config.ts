import { defineConfig, devices } from "@playwright/test";

const chromiumLaunch = {
  launchOptions: { args: ["--disable-dev-shm-usage"] },
};

// Each spec file runs in its own project, so each file gets a fresh browser
// instance. A long-lived browser shared across the heavy WebGL specs has
// died late in the suite (the run ends with "Target page, context or browser
// has been closed" before the next test can open a context), and the death
// is not reproducible from any single spec in isolation.
const chromiumFiles: Array<{ name: string; file: string }> = [
  { name: "chromium-assurance", file: "browser-assurance-capacity.spec.ts" },
  { name: "chromium-keyxym-v22", file: "keyxym-v22-authority.spec.ts" },
  { name: "chromium-keyxym-camera", file: "keyxym-v26-camera.spec.ts" },
  { name: "chromium-keyxym-photo", file: "keyxym-v26-candidate-photographic.spec.ts" },
  { name: "chromium-keyxym-recon", file: "keyxym-v26-candidate-reconstruction.spec.ts" },
  { name: "chromium-handoff", file: "origin-handoff.spec.ts" },
  { name: "chromium-navigation", file: "production-navigation.spec.ts" },
  { name: "chromium-cold-boot", file: "world-cell-cold-boot.spec.ts" },
  { name: "chromium-provenance", file: "world-cell-provenance-reconstruction.spec.ts" },
  { name: "chromium-real-camera", file: "world-cell-real-camera.spec.ts" },
  { name: "chromium-renderer", file: "world-cell-renderer-resilience.spec.ts" },
  { name: "chromium-scan-v4", file: "world-cell-scan-v4-rejection.spec.ts" },
  { name: "chromium-spatial", file: "world-cell-spatial-continuum.spec.ts" },
];

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["github"]] : "line",
  use: {
    baseURL: "http://127.0.0.1:4180",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-origin",
      testMatch: /origin\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumLaunch,
      },
    },
    ...chromiumFiles.map(({ name, file }) => ({
      name,
      testMatch: new RegExp(`${file.replaceAll(".", "\\.")}$`, "u"),
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumLaunch,
      },
    })),
    {
      name: "webkit-iphone",
      testMatch: /world-cell-webkit-smoke\.spec\.ts/u,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4180",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
