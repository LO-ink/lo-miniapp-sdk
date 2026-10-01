import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("canonical source contains no compatibility platform or wire vocabulary", () => {
  const source = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");
  const forbidden =
    /telegram|tgweb|web_app_|widget_link|req_id|file_name|refresh_rate|need_absolute|horizontal_accuracy|window\.lo|window\.telegram/i;
  for (const name of readdirSync(source, { recursive: true })) {
    if (!name.endsWith(".ts")) continue;
    assert.doesNotMatch(
      readFileSync(join(source, name), "utf8"),
      forbidden,
      name,
    );
  }
});

test("SDK has no runtime dependency on hosts, compatibility, or server clients", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    assert.deepEqual(Object.keys(manifest[field] ?? {}), [], field);
  for (const directory of ["dist", "dist-cjs"]) {
    for (const name of readdirSync(join(root, directory), {
      recursive: true,
    })) {
      if (!/\.(?:js|ts)$/.test(name)) continue;
      const body = readFileSync(join(root, directory, name), "utf8");
      assert.doesNotMatch(
        body,
        /telegram|tgweb|web_app_|\.WebApp\b|t\.me\//i,
        name,
      );
      assert.doesNotMatch(
        body,
        /(?:from\s*|require\(\s*|import\(\s*)["'][^./]/,
        name,
      );
    }
  }
});
