import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test("ESM and CommonJS expose the client", async () => {
  const esm = await import("../dist/index.js");
  const cjs = createRequire(import.meta.url)("../dist-cjs/index.js");
  assert.equal(typeof esm.createMiniAppClient, "function");
  assert.equal(typeof cjs.createMiniAppClient, "function");
});

test("import does not require browser globals", async () => {
  assert.equal(typeof globalThis.window, "undefined");
  await import("../dist/index.js?ssr=1");
});
