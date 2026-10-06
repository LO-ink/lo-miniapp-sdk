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
test("a broken host unsubscribe cannot prevent the other listeners and CSS from being released", () => {
  const state = setup({ safeArea: inset(20) }),
    previous = globalThis.document;
  const subscribe = state.client.adapter.subscribe;
  let released = 0;
  state.client.adapter.subscribe = (event, listener) => {
    const release = subscribe(event, listener);
    return () => {
      released++;
      release();
      if (event === "safeAreaChanged") throw new Error("host cleanup failed");
    };
  };
  globalThis.document = { documentElement: { style: state.style } };
  try {
    const release = bindSafeAreaCss(state.client);
    assert.doesNotThrow(release);
    release();
    assert.equal(released, 3);
    assert.equal(state.listeners.size, 0);
    assert.equal(state.values.size, 0);
  } finally {
    globalThis.document = previous;
    state.client.dispose();
  }
});
test("overflowing inset sums cannot write Infinity into CSS", () => {
  const state = setup({
      safeArea: { top: Number.MAX_VALUE, right: 0, bottom: 0, left: 0 },
      contentSafeArea: { top: Number.MAX_VALUE, right: 0, bottom: 0, left: 0 },
    }),
    previous = globalThis.document;
  globalThis.document = { documentElement: { style: state.style } };
  try {
    const release = bindSafeAreaCss(state.client);
    assert.equal(state.values.has("--lo-safe-top"), false);
    release();
  } finally {
    globalThis.document = previous;
    state.client.dispose();
  }
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

test("failed binding stops retained callbacks before restoring owned styles", () => {
  const state = setup({ safeArea: inset(20) });
  const previous = globalThis.document;
  globalThis.document = { documentElement: { style: state.style } };
  let retained;
  const original = state.client.on;
  state.client.on = (event, listener) => {
    if (event === "contentSafeAreaChanged")
      throw new Error("Subscription failed");
    retained = listener;
    return () => {
      throw new Error("Cleanup failed");
    };
  };
  try {
    state.values.set("--lo-safe-top", "env(safe-area-inset-top)");
    assert.throws(() => bindSafeAreaCss(state.client), /Subscription failed/);
    retained(inset(88));
    assert.equal(state.values.get("--lo-safe-top"), "env(safe-area-inset-top)");
  } finally {
    state.client.on = original;
    state.client.dispose();
    globalThis.document = previous;
  }
});

function ownershipFixture(t, installDocument = true) {
  const previous = globalThis.document;
  const clients = [];
  const values = new Map();
  const priorities = new Map();
  const style = {
    getPropertyValue: (name) => values.get(name) ?? "",
    getPropertyPriority: (name) => priorities.get(name) ?? "",
    setProperty(name, value, priority = "") {
      values.set(name, value);
      priorities.set(name, priority);
    },
    removeProperty(name) {
      values.delete(name);
      priorities.delete(name);
    },
  };
  if (installDocument) globalThis.document = { documentElement: { style } };
  t.after(() => {
    for (const state of clients) state.client.dispose();
    if (installDocument) globalThis.document = previous;
  });
  return {
    style,
    values,
    client(top) {
      const listeners = new Map();
      const client = createMiniAppClient({
        id: "ownership-fixture",
        launchData: "",
        capabilities: new Set(),
        snapshot: () => (top === undefined ? {} : { safeArea: inset(top) }),
        subscribe(event, fn) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(fn);
          return () => listeners.get(event).delete(fn);
        },
        execute: async () => undefined,
      });
      const state = {
        client,
        emit(event, value) {
          for (const fn of [...(listeners.get(event) ?? [])]) fn(value);
        },
      };
      clients.push(state);
      return state;
    },
  };
}

for (const equal of [true, false]) {
  for (const olderFirst of [true, false]) {
    test(`overlapping CSS owners: equal=${equal}, older releases first=${olderFirst}`, (t) => {
      const fixture = ownershipFixture(t);
      fixture.style.setProperty(
        "--lo-safe-top",
        "env(safe-area-inset-top)",
        "important",
      );
      const old = fixture.client(10),
        next = fixture.client(equal ? 10 : 20);
      const releaseOld = bindSafeAreaCss(old.client);
      const releaseNext = bindSafeAreaCss(next.client);
      assert.equal(
        fixture.style.getPropertyValue("--lo-safe-top"),
        equal ? "10px" : "20px",
      );
      if (olderFirst) {
        releaseOld();
        releaseOld();
        assert.equal(
          fixture.style.getPropertyValue("--lo-safe-top"),
          equal ? "10px" : "20px",
        );
        releaseNext();
      } else {
        releaseNext();
        releaseNext();
        assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "10px");
        releaseOld();
      }
      assert.equal(
        fixture.style.getPropertyValue("--lo-safe-top"),
        "env(safe-area-inset-top)",
      );
      assert.equal(
        fixture.style.getPropertyPriority("--lo-safe-top"),
        "important",
      );
      assert.equal(fixture.values.has("--lo-safe-bottom"), false);
    });
  }
}

test("two bindings of the same client remain active after the older release", (t) => {
  const fixture = ownershipFixture(t),
    state = fixture.client(10);
  const first = bindSafeAreaCss(state.client),
    second = bindSafeAreaCss(state.client);
  first();
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "10px");
  state.emit("safeAreaChanged", inset(35));
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "35px");
  second();
  assert.equal(fixture.values.size, 0);
});

test("non-top inset updates wait for ownership, including a previously empty binding", (t) => {
  const fixture = ownershipFixture(t),
    old = fixture.client(),
    next = fixture.client(20);
  const releaseOld = bindSafeAreaCss(old.client),
    releaseNext = bindSafeAreaCss(next.client);
  old.emit("safeAreaChanged", inset(15));
  old.emit("contentSafeAreaChanged", inset(7));
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "20px");
  releaseNext();
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "22px");
  releaseOld();
  assert.equal(fixture.values.size, 0);
});

test("different prefixes and style targets have independent ownership", (t) => {
  const a = ownershipFixture(t),
    one = a.client(10);
  const releaseA = bindSafeAreaCss(one.client);
  const releaseCustom = bindSafeAreaCss(one.client, { prefix: "--game" });
  const b = ownershipFixture(t, false),
    two = b.client(20);
  globalThis.document = { documentElement: { style: b.style } };
  const releaseB = bindSafeAreaCss(two.client);
  releaseA();
  assert.equal(a.style.getPropertyValue("--lo-safe-top"), "");
  assert.equal(a.style.getPropertyValue("--game-top"), "10px");
  assert.equal(b.style.getPropertyValue("--lo-safe-top"), "20px");
  releaseCustom();
  releaseB();
  assert.equal(a.values.size, 0);
  assert.equal(b.values.size, 0);
});

for (const updateAfterExternal of [false, true]) {
  test(`external mutation preserved with overlapping owners; later update=${updateAfterExternal}`, (t) => {
    const fixture = ownershipFixture(t),
      old = fixture.client(10),
      next = fixture.client(20);
    const releaseOld = bindSafeAreaCss(old.client),
      releaseNext = bindSafeAreaCss(next.client);
    fixture.style.setProperty("--lo-safe-top", "99px", "important");
    if (updateAfterExternal) {
      next.emit("safeAreaChanged", inset(30));
      assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "30px");
    }
    releaseOld();
    releaseNext();
    assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "99px");
    assert.equal(
      fixture.style.getPropertyPriority("--lo-safe-top"),
      "important",
    );
  });
}

test("external equal-value priority change is not mistaken for SDK ownership", (t) => {
  const fixture = ownershipFixture(t),
    state = fixture.client(10);
  const release = bindSafeAreaCss(state.client);
  fixture.style.setProperty("--lo-safe-top", "10px", "important");
  release();
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "10px");
  assert.equal(fixture.style.getPropertyPriority("--lo-safe-top"), "important");
});

test("failed second subscription restores active first owner and suppresses retained callbacks", (t) => {
  const fixture = ownershipFixture(t),
    old = fixture.client(10),
    next = fixture.client(20);
  const releaseOld = bindSafeAreaCss(old.client);
  let retained;
  next.client.on = (event, listener) => {
    if (event === "contentSafeAreaChanged")
      throw new Error("second subscription failed");
    retained = listener;
    return () => {
      throw new Error("cleanup failed");
    };
  };
  assert.throws(
    () => bindSafeAreaCss(next.client),
    /second subscription failed/,
  );
  retained(inset(88));
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "10px");
  old.emit("safeAreaChanged", inset(12));
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "12px");
  releaseOld();
  assert.equal(fixture.values.size, 0);
});

test("snapshot failure and partial CSS-write failure leave the earlier binding intact", (t) => {
  const fixture = ownershipFixture(t),
    old = fixture.client(10),
    next = fixture.client(20);
  const releaseOld = bindSafeAreaCss(old.client);
  const snapshot = next.client.adapter.snapshot;
  next.client.adapter.snapshot = () => {
    throw new Error("snapshot failed");
  };
  assert.throws(() => bindSafeAreaCss(next.client), /snapshot failed/);
  next.client.adapter.snapshot = snapshot;
  const set = fixture.style.setProperty;
  let failed = false;
  fixture.style.setProperty = (name, value, priority) => {
    if (!failed && name === "--lo-safe-right") {
      failed = true;
      throw new Error("style failed");
    }
    set(name, value, priority);
  };
  assert.throws(() => bindSafeAreaCss(next.client), /style failed/);
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "10px");
  old.emit("safeAreaChanged", inset(13));
  assert.equal(fixture.style.getPropertyValue("--lo-safe-top"), "13px");
  releaseOld();
  assert.equal(fixture.values.size, 0);
});
