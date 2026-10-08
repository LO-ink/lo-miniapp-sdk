import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
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
      if (/^server\.(?:js|d\.ts)$/.test(name)) {
        const dependencies = [
          ...body.matchAll(
            /(?:from\s*|require\(\s*|import\(\s*)["']([^"']+)["']/g,
          ),
        ]
          .map((match) => match[1])
          .filter((name) => !name.startsWith("."));
        assert.deepEqual(
          dependencies,
          name.endsWith(".d.ts") ? [] : ["node:crypto"],
          name,
        );
        continue;
      }
      assert.doesNotMatch(
        body,
        /(?:from\s*|require\(\s*|import\(\s*)["'][^./]/,
        name,
      );
      assert.doesNotMatch(
        body,
        /(?:from\s*|require\(\s*|import\(\s*)["']\.\/server(?:\.js)?["']/,
        name,
      );
    }
  }
});

test("tracked Markdown links resolve to tracked documents and assets", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  );
  for (const path of tracked) {
    if (!path.endsWith(".md")) continue;
    const body = readFileSync(join(root, path), "utf8");
    for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
      const file = relative(
        root,
        resolve(
          dirname(join(root, path)),
          decodeURIComponent(target.split(/[?#]/)[0]),
        ),
      );
      assert.ok(tracked.has(file), `${path}: missing tracked link ${target}`);
    }
  }
});
