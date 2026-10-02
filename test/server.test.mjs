import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyInitData, InitDataError } from "../dist/server.js";
const vectors = JSON.parse(
  readFileSync(
    new URL("../go/initdata/testdata/initdata.json", import.meta.url),
    "utf8",
  ),
);
const cjs = createRequire(import.meta.url)("../dist-cjs/server.js");
for (const [format, verify] of [
  ["ESM", verifyInitData],
  ["CJS", cjs.verifyInitData],
]) {
  for (const vector of vectors)
    test(`${format}: ${vector.name}`, () => {
      if (vector.error)
        assert.throws(
          () => verify(vector.raw, vector),
          (e) => e.code === vector.error && e.name === "InitDataError",
        );
      else {
        const result = verify(vector.raw, vector);
        const compact = JSON.parse(
          JSON.stringify(result, (_key, value) =>
            value === "" ? undefined : value,
          ),
        );
        const expected = JSON.parse(
          JSON.stringify(vector.expected, (_key, value) =>
            value === "" ? undefined : value,
          ),
        );
        assert.deepEqual(compact, expected);
      }
    });
}
test("bad options fail closed", () => {
  for (const options of [
    {},
    { ...vectors[0], maxAgeSec: -1 },
    { ...vectors[0], nowSec: NaN },
  ])
    assert.throws(() => verifyInitData(vectors[0].raw, options), TypeError);
});
test("signature error is typed and contains no raw credentials", () => {
  assert.throws(
    () => verifyInitData("hash=bad", vectors[0]),
    (e) => e instanceof InitDataError && e.message === "invalid-signature",
  );
});
