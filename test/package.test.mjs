import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
      "@lo-ink",
      "miniapp-sdk",
    );
    mkdirSync(packDirectory, { recursive: true });
    mkdirSync(packageDirectory, { recursive: true });
    const packed = JSON.parse(
      run("npm", ["pack", "--pack-destination", packDirectory, "--json"], {
        env: { ...process.env, npm_config_cache: join(temporary, "npm-cache") },
      }),
    )[0];
    assert.equal(packed.name, "@lo-ink/miniapp-sdk");
    assert.equal(
      packed.version,
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
    );
    const archive = join(packDirectory, packed.filename);
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

    for (const [api, olderFirst] of [
      [esm, true],
      [esm, false],
      [cjs, true],
      [cjs, false],
    ]) {
      const previousDocument = globalThis.document;
      const values = new Map([["--lo-safe-top", "17px"]]);
      const priorities = new Map([["--lo-safe-top", "important"]]);
      globalThis.document = {
        documentElement: {
          style: {
            getPropertyValue: (name) => values.get(name) ?? "",
            getPropertyPriority: (name) => priorities.get(name) ?? "",
            setProperty: (name, value, priority = "") => {
              if (
                priorities.get(name) === "important" &&
                priority !== "important"
              )
                return;
              values.set(name, value);
              priorities.set(name, priority);
            },
            removeProperty: (name) => {
              values.delete(name);
              priorities.delete(name);
            },
          },
        },
      };
      const client = api.createMiniAppClient({
        id: "packed-css-ownership",
        launchData: "",
        capabilities: new Set(),
        snapshot: () => ({
          safeArea: { top: 10, right: 0, bottom: 0, left: 0 },
        }),
        subscribe: () => () => {},
        execute: async () => undefined,
      });
      try {
        const first = api.bindSafeAreaCss(client);
        const second = api.bindSafeAreaCss(client);
        assert.equal(values.get("--lo-safe-top"), "10px");
        assert.equal(priorities.get("--lo-safe-top"), "");
        (olderFirst ? first : second)();
        assert.equal(values.get("--lo-safe-top"), "10px");
        (olderFirst ? second : first)();
        assert.equal(values.get("--lo-safe-top"), "17px");
        assert.equal(priorities.get("--lo-safe-top"), "important");
        assert.equal(values.size, 1);
      } finally {
        client.dispose();
        globalThis.document = previousDocument;
      }
    }

    const consumer = dirname(dirname(dirname(packageDirectory)));
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { createMiniAppClient } from '@lo-ink/miniapp-sdk';
      import { verifyInitData, InitDataError } from '@lo-ink/miniapp-sdk/server';
      if (typeof verifyInitData !== 'function' || typeof InitDataError !== 'function') throw new Error('ESM server exports failed');
      import { MINI_APP_PROTOCOL_VERSION } from '@lo-ink/miniapp-sdk/protocol';
      if (typeof createMiniAppClient !== 'function' || MINI_APP_PROTOCOL_VERSION !== 1) throw new Error('ESM public exports failed');
    `,
      ],
      { cwd: consumer },
    );
    run(
      process.execPath,
      [
        "-e",
        `
      const { createMiniAppClient } = require('@lo-ink/miniapp-sdk');
      const { verifyInitData, InitDataError } = require('@lo-ink/miniapp-sdk/server');
      if (typeof verifyInitData !== 'function' || typeof InitDataError !== 'function') throw new Error('CJS server exports failed');
      const { MINI_APP_PROTOCOL_VERSION } = require('@lo-ink/miniapp-sdk/protocol');
      if (typeof createMiniAppClient !== 'function' || MINI_APP_PROTOCOL_VERSION !== 1) throw new Error('CommonJS public exports failed');
    `,
      ],
      { cwd: consumer },
    );
    writeFileSync(
      join(consumer, "esm.mts"),
      'import { type Capability } from "@lo-ink/miniapp-sdk"; const value: Capability = "invoice"; void value;\n',
    );
    writeFileSync(
      join(consumer, "cjs.cts"),
      'import sdk = require("@lo-ink/miniapp-sdk"); const value: sdk.MiniAppError = new sdk.MiniAppError("failed"); void value;\n',
    );
    writeFileSync(
      join(consumer, "bundler.ts"),
      'import { MINI_APP_PROTOCOL_VERSION } from "@lo-ink/miniapp-sdk/protocol"; const value: 1 = MINI_APP_PROTOCOL_VERSION; void value;\n',
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
