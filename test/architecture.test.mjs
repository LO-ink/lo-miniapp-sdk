import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("canonical source contains no compatibility platform or wire vocabulary", () => {
  const source = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");
  const forbidden =
    /telegram|tgweb|web_app_|widget_link|req_id|file_name|refresh_rate|need_absolute|horizontal_accuracy|window\.lo|window\.telegram/i;
  for (const name of readdirSync(source)) {
    if (!name.endsWith(".ts")) continue;
    assert.doesNotMatch(
      readFileSync(join(source, name), "utf8"),
      forbidden,
      name,
    );
  }
});
