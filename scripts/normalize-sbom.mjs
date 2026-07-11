import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error("usage: node scripts/normalize-sbom.mjs INPUT OUTPUT");
}

const workspace = resolve(".").replaceAll("\\", "/");
const parsed = JSON.parse(await readFile(inputPath, "utf8"));

function normalize(value) {
  if (typeof value === "string") {
    return value.replaceAll("\\", "/").replaceAll(workspace, "/workspace/tessaryn");
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "serialNumber") continue;
    result[key] = key === "timestamp" ? "1970-01-01T00:00:00.000Z" : normalize(child);
  }
  return result;
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(normalize(parsed), null, 2) + "\n", "utf8");
