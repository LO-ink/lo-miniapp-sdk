import test from "node:test";
import assert from "node:assert/strict";
import {
  createMiniAppClient,
  cloudStorage,
  deviceStorage,
  secureStorage,
  requestContact,
  requestWriteAccess,
  shareMessage,
  shareToStory,
  setVerticalSwipes,
} from "../dist/index.js";

function client(execute, capabilities) {
  return createMiniAppClient({
    id: "lo",
    launchData: "signed",
    capabilities: new Set(capabilities),
    snapshot: () => ({}),
    subscribe: () => () => {},
    execute,
  });
}

test("storage facades keep null, restore state and cancellation semantics", async () => {
  const calls = [];
  const sdk = client(
    (operation, input, context) => {
      calls.push([operation, input]);
      assert.ok(context.signal instanceof AbortSignal);
      return Promise.resolve(
        operation === "secureStorageGet"
          ? { value: null, canRestore: true }
          : operation.endsWith("Get")
            ? null
            : operation.endsWith("GetMany")
              ? { a: "one" }
              : operation.endsWith("Keys")
                ? ["a"]
                : true,
      );
    },
    ["cloudStorage", "deviceStorage", "secureStorage"],
  );
  const cloud = cloudStorage(sdk),
    device = deviceStorage(sdk),
    secure = secureStorage(sdk);
  await cloud.setItem("a", "one");
  assert.equal(await cloud.getItem("a"), null);
  assert.deepEqual(await cloud.getItems(["a"]), { a: "one" });
  assert.deepEqual(await cloud.getKeys(), ["a"]);
  await cloud.removeItem("a");
  await cloud.removeItems(["b"]);
  await device.setItem("a", "one");
  assert.equal(await device.getItem("a"), null);
  await device.removeItem("a");
  await device.clear();
  await secure.setItem("a", "one");
  assert.deepEqual(await secure.getItem("a"), {
    value: null,
    canRestore: true,
  });
  await secure.restoreItem("a");
  await secure.removeItem("a");
  await secure.clear();
  const abort = new AbortController();
  abort.abort();
  const before = calls.length;
  await assert.rejects(secure.getItem("a", { signal: abort.signal }), {
    code: "aborted",
  });
  assert.equal(calls.length, before);
  sdk.dispose();
});

test("consent refusals remain false and feature helpers reject invalid inputs before transport", async () => {
  const calls = [];
  const sdk = client(
    (operation, input) => {
      calls.push([operation, input]);
      return Promise.resolve(false);
    },
    [
      "requestWriteAccess",
      "requestContact",
      "shareMessage",
      "shareToStory",
      "verticalSwipes",
    ],
  );
  assert.equal(await requestWriteAccess(sdk), false);
  assert.equal(await requestContact(sdk), false);
  assert.equal(await shareMessage(sdk, "prepared-id"), false);
  await setVerticalSwipes(sdk, true);
  await shareToStory(sdk, "https://example.com/media.png", {
    text: "Story",
    link: { url: "https://example.com/game", name: "Play" },
  });
  const count = calls.length;
  for (const id of ["", "x".repeat(129), 42])
    await assert.rejects(shareMessage(sdk, id), TypeError);
  await assert.rejects(setVerticalSwipes(sdk, "yes"), TypeError);
  for (const [url, params] of [
    ["http://example.com/a.png"],
    ["https://user:secret@example.com/a"],
    ["https://example.com/\nimage"],
    ["https://example.com/a", { text: "x".repeat(2049) }],
    ["https://example.com/a", { link: { url: "javascript:alert(1)" } }],
    [
      "https://example.com/a",
      { link: { url: "https://example.com", name: "x".repeat(49) } },
    ],
  ])
    await assert.rejects(shareToStory(sdk, url, params), TypeError);
  assert.equal(calls.length, count);
  sdk.dispose();
});
