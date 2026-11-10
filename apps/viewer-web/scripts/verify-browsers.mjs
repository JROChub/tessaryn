// Launches the browsers the end-to-end suite needs and reports whether each
// one starts. A browser that cannot start fails here, before the suite runs,
// so a missing system library is reported at this step with its own error
// instead of surfacing later as a confusing test failure.
import { chromium, webkit } from "playwright-core";

const browsers = [
  ["chromium", chromium],
  ["webkit", webkit],
];

let failed = false;
for (const [name, browserType] of browsers) {
  try {
    const browser = await browserType.launch();
    await browser.close();
    console.log(`${name}: launch ok`);
  } catch (error) {
    failed = true;
    console.error(`${name}: launch failed`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (failed) {
  console.error(
    "One or more browsers could not launch. Install the missing system libraries " +
      "(for example: npx playwright install-deps chromium webkit) and retry.",
  );
  process.exitCode = 1;
}
