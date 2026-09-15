import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

test("packed package imports and typechecks for ESM, CommonJS, and bundlers", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "lo-sdk-package-"));
  try {
    const packDirectory = join(temporary, "pack");
    const packageDirectory = join(
      temporary,
      "consumer",
      "node_modules",
      "@lo",
      "miniapp-sdk",
    );
    mkdirSync(packDirectory, { recursive: true });
    mkdirSync(packageDirectory, { recursive: true });
    run("npm", ["pack", "--pack-destination", packDirectory, "--json"], {
      env: { ...process.env, npm_config_cache: join(temporary, "npm-cache") },
    });
    const archive = join(
      packDirectory,
      readdirSync(packDirectory).find((name) => name.endsWith(".tgz")),
    );
    run("tar", [
      "-xzf",
      archive,
      "--strip-components=1",
      "-C",
      packageDirectory,
    ]);

    const esm = await import(
      pathToFileURL(join(packageDirectory, "dist", "index.js")).href
    );
    const cjs = createRequire(import.meta.url)(
      join(packageDirectory, "dist-cjs", "index.js"),
    );
    assert.equal(typeof esm.createMiniAppClient, "function");
    assert.equal(typeof cjs.createMiniAppClient, "function");

    const consumer = dirname(dirname(dirname(packageDirectory)));
    writeFileSync(
      join(consumer, "esm.mts"),
      'import { type Capability } from "@lo/miniapp-sdk"; const value: Capability = "invoice"; void value;\n',
    );
    writeFileSync(
      join(consumer, "cjs.cts"),
      'import sdk = require("@lo/miniapp-sdk"); const value: sdk.MiniAppError = new sdk.MiniAppError("failed"); void value;\n',
    );
    writeFileSync(
      join(consumer, "bundler.ts"),
      'import { MINI_APP_PROTOCOL_VERSION } from "@lo/miniapp-sdk/protocol"; const value: 1 = MINI_APP_PROTOCOL_VERSION; void value;\n',
    );
    const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
    const common = [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
    ];
    run(process.execPath, [
      tsc,
      ...common,
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      join(consumer, "esm.mts"),
    ]);
    run(process.execPath, [
      tsc,
      ...common,
      "--module",
      "Node16",
      "--moduleResolution",
      "Node16",
      join(consumer, "cjs.cts"),
    ]);
    run(process.execPath, [
      tsc,
      ...common,
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      join(consumer, "bundler.ts"),
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
