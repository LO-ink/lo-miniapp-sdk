import test from "node:test";
import assert from "node:assert/strict";
import { createMiniAppClient } from "../dist/index.js";

const adapter = (overrides = {}) => ({
  id: "lo",
  launchData: "assertion",
  capabilities: new Set(["clipboard"]),
  snapshot: () => ({}),
  subscribe: () => () => {},
  execute: () => new Promise(() => {}),
  ...overrides,
});

test("unknown operations cannot bypass capability checks through JavaScript", async () => {
  let calls = 0;
  const client = createMiniAppClient(
    adapter({
      execute() {
        calls++;
      },
    }),
  );
  for (const operation of [
    "foreignOperation",
    "__proto__",
    "constructor",
    null,
  ])
    await assert.rejects(client.call(operation, undefined), {
      code: "unsupported",
    });
  for (const input of [undefined, null, {}, { button: "foreign" }])
    await assert.rejects(client.call("setButton", input), TypeError);
  assert.equal(calls, 0);
  client.dispose();
});

test("invalid adapters fail at construction before acquiring resources", () => {
  for (const value of [
    null,
    {},
    adapter({ id: "" }),
    adapter({ capabilities: null }),
    adapter({ subscribe: null }),
  ])
    assert.throws(() => createMiniAppClient(value), TypeError);
});

test("retained event callbacks cannot reach a released or disposed subscriber", () => {
  const callbacks = [];
  let delivered = 0;
  const client = createMiniAppClient(
    adapter({
      subscribe(_event, listener) {
        callbacks.push(listener);
        return () => {};
      },
    }),
  );
  const off = client.on("activated", () => delivered++);
  callbacks[0]();
  off();
  callbacks[0]();
  client.on("activated", () => delivered++);
  client.dispose();
  callbacks[1]();
  assert.equal(delivered, 1);
});

test("reentrant transport cancellation cannot replace an abort or timeout outcome", async () => {
  for (const reason of ["aborted", "timeout"]) {
    const external = new AbortController();
    let cleanups = 0;
    let client;
    client = createMiniAppClient(
      adapter({
        execute(_operation, _input, { signal }) {
          signal.addEventListener("abort", () => client.dispose());
          return { promise: new Promise(() => {}), cleanup: () => cleanups++ };
        },
      }),
    );
    const pending = client.call("readClipboard", undefined, {
      signal: external.signal,
      timeoutMs: reason === "timeout" ? 5 : 1000,
    });
    if (reason === "aborted") external.abort();
    await assert.rejects(pending, { code: reason });
    assert.equal(client.disposed, true);
    assert.equal(cleanups, 1);
  }
});

test("vertical swipe configuration is a typed LO capability", async () => {
  const calls = [];
  const client = createMiniAppClient(
    adapter({
      capabilities: new Set(["verticalSwipes"]),
      execute(operation, input) {
        calls.push([operation, input]);
        return Promise.resolve();
      },
    }),
  );
  await client.call("setVerticalSwipes", { enabled: false });
  await client.call("setVerticalSwipes", { enabled: true });
  assert.deepEqual(calls, [
    ["setVerticalSwipes", { enabled: false }],
    ["setVerticalSwipes", { enabled: true }],
  ]);
  client.dispose();
});

test("transport abort precedes cleanup for cancellation, timeout and disposal", async () => {
  for (const reason of ["aborted", "timeout", "disposed"]) {
    const external = new AbortController();
    const events = [];
    const client = createMiniAppClient(
      adapter({
        execute(_operation, _input, { signal }) {
          const cancelTransport = () => events.push("abort");
          signal.addEventListener("abort", cancelTransport);
          return {
            promise: new Promise(() => {}),
            cleanup() {
              assert.equal(signal.aborted, true);
              events.push("cleanup");
              signal.removeEventListener("abort", cancelTransport);
            },
          };
        },
      }),
    );
    const pending = client.call("readClipboard", undefined, {
      signal: external.signal,
      timeoutMs: reason === "timeout" ? 5 : 1000,
    });
    if (reason === "aborted") external.abort();
    if (reason === "disposed") client.dispose();
    await assert.rejects(pending, { code: reason });
    assert.deepEqual(events, ["abort", "cleanup"]);
    client.dispose();
  }
});
