import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptUrl = new URL("../scripts/create-extensionless-routes.mjs", import.meta.url);

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

test("build creates a canonical extensionless World Cell route with corrected asset paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "tessaryn-route-"));
  const dist = join(root, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "world-cell-theater.html"), [
    "<!doctype html>",
    "<html>",
    "  <head>",
    '    <link rel="stylesheet" href="./assets/theater.css">',
    "  </head>",
    "  <body>",
    '    <script type="module" src="./assets/theater.js"></script>',
    '    <a href="./">home</a>',
    "  </body>",
    "</html>",
  ].join("\n"));

  await runNode([scriptUrl.pathname], {
    ...process.env,
    TESSARYN_DIST_DIRECTORY: dist,
  });

  const route = await readFile(join(dist, "world-cell-theater", "index.html"), "utf8");
  assert.match(route, /<base href="\.\.\/">/);
  assert.match(route, /href="\.\.\/assets\/theater\.css"/);
  assert.match(route, /src="\.\.\/assets\/theater\.js"/);
  assert.match(route, /href="\.\.\/"/);
});
