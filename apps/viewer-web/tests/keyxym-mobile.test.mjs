import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../keyxym-mobile.html", import.meta.url), "utf8");
const source = await readFile(new URL("../src/keyxym-mobile.ts", import.meta.url), "utf8");
const origin = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("origin exposes the iPhone mobile demo", () => {
  assert.match(origin, /href="\.\/keyxym-mobile\.html"/);
  assert.match(origin, /MOBILE DEMO/);
});

test("mobile route is iPhone installable and local-first", () => {
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /capture="environment"/);
  assert.match(html, /does not publish source bytes/);
});

test("mobile implementation uses bounded incremental hashing and durable journals", () => {
  assert.match(source, /const CHUNK_BYTES = 256 \* 1024/);
  assert.match(source, /sha256\.create\(\)/);
  assert.match(source, /indexedDB\.open/);
  assert.match(source, /acknowledged/);
  assert.match(source, /simulated peer admitted for local demonstration/);
});
