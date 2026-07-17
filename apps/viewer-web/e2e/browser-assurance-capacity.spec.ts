import { expect, test } from "@playwright/test";

test("browser assurance seals production-scale canonical Cells", async ({ page }) => {
  await page.goto("/world-cell-theater/", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-world-cell-assurance", "verified");
  const result = await page.evaluate(async () => {
    const bridge = window.tessarynAssurance;
    if (!bridge) throw new Error("browser assurance bridge unavailable");
    const hex = (bytes: ArrayBuffer): string => Array.from(
      new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0"),
    ).join("");
    const results: Array<{ bytes: number; sealed: boolean; error?: string }> = [];
    for (const bytes of [64_000, 256_000, 512_000, 1_000_000]) {
      const canonicalCell = JSON.stringify({ schema: "tessaryn/world-cell/v26", payload: "x".repeat(bytes) });
      const canonicalDigest = hex(await crypto.subtle.digest(
        "SHA-256", new TextEncoder().encode(canonicalCell),
      ));
      const evidence = {
        profile: "eform/world-cell-assurance/v1" as const,
        artifactKind: "world-cell" as const,
        canonicalDigest,
        reconstructionReceipt: "11".repeat(32),
        runtimeCommitment: "22".repeat(32),
        parentCommitment: "33".repeat(32),
        sequence: 2,
        metricScale: false,
      };
      try {
        const seal = await bridge.sealWorldCell({ canonicalCell, evidence });
        results.push({
          bytes: canonicalCell.length,
          sealed: await bridge.verifyWorldCell({ canonicalCell, evidence, seal }),
        });
      } catch (error) {
        results.push({
          bytes: canonicalCell.length,
          sealed: false,
          error: error instanceof Error ? error.stack ?? error.message : String(error),
        });
        break;
      }
    }
    return results;
  });
  console.log("BROWSER_ASSURANCE_CAPACITY", JSON.stringify(result));
  expect(result).toHaveLength(4);
  expect(result.every((entry) => entry.sealed)).toBe(true);
  expect(result.at(-1)?.bytes).toBeGreaterThan(1_000_000);
});
