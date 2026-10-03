import test from "node:test";
import assert from "node:assert/strict";
import { parseLaunchDataUnsafe, createMiniAppClient } from "../dist/index.js";
const raw = (user) =>
  new URLSearchParams({
    user: typeof user === "string" ? user : JSON.stringify(user),
    app_id: "test",
    auth_date: "1800000000",
    chat_type: "private",
    start_param: "42",
  }).toString();
test("user identity preserves full integer token on all Node/browser versions", () => {
  const result = parseLaunchDataUnsafe(
    raw('{"id":9007199254740993,"first_name":"Анна","language_code":""}'),
  );
  assert.equal(result.user.id, "9007199254740993");
  assert.equal(result.user.firstName, "Анна");
  assert.equal(result.user.languageCode, "");
  assert.equal(result.startParam, "42");
  assert.equal(result.authDate, 1800000000);
});
test("avatar is limited to HTTPS subdomains of lo.ink", () => {
  for (const photo_url of [
    "https://cdn.lo.ink/avatar.png",
    "http://cdn.lo.ink/a",
    "https://lo.ink.evil.test/a",
    "https://evil.test/a",
    "javascript:alert(1)",
    "https://user@cdn.lo.ink/a",
  ]) {
    assert.equal(
      parseLaunchDataUnsafe(raw({ id: "42", photo_url })).user.photoUrl,
      photo_url === "https://cdn.lo.ink/avatar.png" ? photo_url : undefined,
    );
  }
  assert.equal(parseLaunchDataUnsafe(raw({ id: 42 })).user.photoUrl, undefined);
});
test("malformed and duplicate values cannot accidentally produce a display identity", () => {
  for (const value of [
    "user=%FF",
    "user=x",
    "user=%7B%7D",
    raw('{"id":1,"id":2}'),
    raw({ id: 42 }) + "&%75ser=x",
  ])
    assert.deepEqual(parseLaunchDataUnsafe(value), {});
});
test("client exposes launchUnsafe without host requests", () => {
  const client = createMiniAppClient({
    id: "test",
    launchData: raw({ id: "42" }),
    capabilities: new Set(),
    snapshot: () => ({}),
    subscribe: () => () => {},
    execute: () => {
      throw new Error("network must not run");
    },
  });
  assert.equal(client.launchUnsafe().user.id, "42");
  client.dispose();
});
