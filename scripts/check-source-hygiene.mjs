import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".vite",
  "artifacts",
  "corpus",
  "dist",
  "node_modules",
  "playwright-report",
  "target",
  "test-results",
]);
const reviewedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".webmanifest",
  ".yml",
  ".yaml",
]);
const generatedLongLineFiles = new Set([
  "Cargo.lock",
  "apps/viewer-web/package-lock.json",
  "apps/viewer-web/keyxym-mobile.html",
  "apps/viewer-web/public/keyxym/keyxym-v22.mjs",
  "apps/viewer-web/public/world/archviz-tiny-house-locus.json",
  "apps/viewer-web/public/world/vesper-court.json",
  "apps/viewer-web/world-cell-theater.html",
  "apps/viewer-web/src/world-cell-theater.css",
  "apps/viewer-web/src/world-cell-theater.ts",
  "conformance/reconstruction-v0/minimal-artifact.json",
]);
const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const decoder = new TextDecoder("utf-8", { fatal: true });
const failures = [];
let filesChecked = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) await inspect(path);
  }
}

async function inspect(path) {
  const local = relative(root, path).replaceAll("\\", "/");
  const extension = extname(path);
  if (!reviewedExtensions.has(extension) && !["LICENSE", "SECURITY.md"].includes(local)) {
    return;
  }
  let text;
  try {
    text = decoder.decode(await readFile(path));
  } catch {
    failures.push(`${local}: invalid UTF-8`);
    return;
  }
  filesChecked += 1;
  if (text.includes("\0")) failures.push(`${local}: NUL byte`);
  if (text.includes("\r")) failures.push(`${local}: CR or CRLF line ending`);
  if (bidiControls.test(text)) failures.push(`${local}: bidirectional Unicode control`);
  if (!generatedLongLineFiles.has(local) && !local.startsWith("sbom/")) {
    text.split("\n").forEach((line, index) => {
      if (line.length > 500) failures.push(`${local}:${String(index + 1)}: line exceeds 500 characters`);
    });
  }
}

await walk(root);
if (failures.length > 0) {
  throw new Error(`source hygiene failed:\n${failures.join("\n")}`);
}
console.log(`SOURCE HYGIENE PASS: ${String(filesChecked)} UTF-8 text files, no bidi controls or collapsed source`);
