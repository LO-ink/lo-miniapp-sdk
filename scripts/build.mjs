import { rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
for (const directory of ["dist", "dist-cjs"]) {
  rmSync(new URL(`../${directory}`, import.meta.url), {
    recursive: true,
    force: true,
  });
}

for (const args of [
  [],
  [
    "--module",
    "CommonJS",
    "--moduleResolution",
    "Node",
    "--outDir",
    "dist-cjs",
  ],
]) {
  const result = spawnSync(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json", ...args],
    { cwd: new URL("..", import.meta.url), stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

writeFileSync(
  new URL("../dist-cjs/package.json", import.meta.url),
  '{"type":"commonjs"}\n',
);
