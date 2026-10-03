import test from "node:test";
import assert from "node:assert/strict";
import { bindSafeAreaCss, createMiniAppClient } from "../dist/index.js";
const inset = (top) => ({ top, right: 0, bottom: 10, left: 0 });
function setup(snapshot) {
  const values = new Map();
  const style = {
    getPropertyValue: (name) => values.get(name) ?? "",
    getPropertyPriority: () => "",
    setProperty: (name, value) => values.set(name, value),
    removeProperty: (name) => values.delete(name),
  };
  const listeners = new Map();
  const client = createMiniAppClient({
    id: "test",
    launchData: "",
    capabilities: new Set(),
    snapshot: () => snapshot,
    subscribe: (event, fn) => {
      listeners.set(event, fn);
      return () => listeners.delete(event);
    },
    execute: () => Promise.resolve(),
  });
  return {
    style,
    values,
    client,
    listeners,
    emit: (event, value) => listeners.get(event)?.(value),
  };
}
test("CSS sums initial and event insets, restores styles and unsubscribes", () => {
  const state = setup({ safeArea: inset(20), contentSafeArea: inset(44) });
  const previous = globalThis.document;
  globalThis.document = { documentElement: { style: state.style } };
  try {
    state.style.setProperty("--lo-safe-top", "env(safe-area-inset-top)");
    const release = bindSafeAreaCss(state.client);
    assert.equal(state.values.get("--lo-safe-top"), "64px");
    state.emit("safeAreaChanged", inset(30));
    assert.equal(state.values.get("--lo-safe-top"), "74px");
    state.emit("contentSafeAreaChanged", inset(40));
    assert.equal(state.values.get("--lo-safe-top"), "70px");
    state.emit("viewportChanged", {
      safeArea: inset(15),
      contentSafeArea: inset(25),
    });
    assert.equal(state.values.get("--lo-safe-top"), "40px");
    release();
    release();
    assert.equal(state.listeners.size, 0);
    assert.equal(state.values.get("--lo-safe-top"), "env(safe-area-inset-top)");
    assert.equal(state.values.has("--lo-safe-bottom"), false);
  } finally {
    globalThis.document = previous;
    state.client.dispose();
  }
});
test("missing host insets preserve env fallback; first event activates custom prefix", () => {
  const state = setup({});
  const previous = globalThis.document;
  globalThis.document = { documentElement: { style: state.style } };
  try {
    const release = bindSafeAreaCss(state.client, { prefix: "--game" });
    assert.equal(state.values.size, 0);
    state.emit("safeAreaChanged", inset(12));
    assert.equal(state.values.get("--game-top"), "12px");
    release();
  } finally {
    globalThis.document = previous;
    state.client.dispose();
  }
});
test("SSR binding has no DOM requirement", () => {
  const state = setup({});
  assert.doesNotThrow(() => bindSafeAreaCss(state.client)());
  state.client.dispose();
});

test("older adapters may omit inset events without breaking the initial binding", async () => {
  const { MiniAppError } = await import("../dist/index.js");
  const state = setup({ safeArea: inset(20) });
  state.client.adapter.subscribe = () => {
    throw new MiniAppError("unsupported");
  };
  const previous = globalThis.document;
  globalThis.document = { documentElement: { style: state.style } };
  try {
    const release = bindSafeAreaCss(state.client);
    assert.equal(state.values.get("--lo-safe-top"), "20px");
    release();
    assert.equal(state.values.size, 0);
  } finally {
    globalThis.document = previous;
    state.client.dispose();
  }
});
