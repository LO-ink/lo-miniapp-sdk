import test from "node:test";
import assert from "node:assert/strict";
import {
  bindAppearance,
  createMiniAppClient,
  MiniAppError,
  shareToStory,
  withHostCallback,
} from "../dist/index.js";

function adapter(overrides = {}) {
  return {
    id: "test",
    launchData: "signed",
    capabilities: new Set(["clipboard"]),
    snapshot: () => ({}),
    subscribe: () => () => {},
    execute: () => Promise.resolve("value"),
    ...overrides,
  };
}

test("invalid request options reject before acquiring host resources", async () => {
  let starts = 0;
  const client = createMiniAppClient(
    adapter({
      execute: () => {
        starts++;
        return Promise.resolve();
      },
    }),
  );
  for (const options of [null, 1, [], { signal: {} }, { signal: null }]) {
    await assert.rejects(
      client.call("readClipboard", undefined, options),
      TypeError,
    );
    await assert.rejects(
      withHostCallback(() => {
        starts++;
      }, options),
      TypeError,
    );
  }
  assert.equal(starts, 0);
  client.dispose();
});

test("request cleanup uses the original signal after options are reused", async () => {
  for (const start of [
    (options) =>
      createMiniAppClient(
        adapter({ execute: () => new Promise(() => {}) }),
      ).call("readClipboard", undefined, options),
    (options) => withHostCallback(() => {}, options),
  ]) {
    const controller = new AbortController();
    let removals = 0;
    const remove = controller.signal.removeEventListener.bind(
      controller.signal,
    );
    controller.signal.removeEventListener = (...args) => {
      removals++;
      remove(...args);
    };
    const options = { signal: controller.signal };
    const pending = start(options);
    options.signal = new AbortController().signal;
    controller.abort();
    await assert.rejects(pending, (error) => error.code === "aborted");
    assert.equal(removals, 1);
  }
});

test("rejects unsupported operations before invoking adapter", async () => {
  let invoked = false;
  const client = createMiniAppClient(
    adapter({
      execute: () => {
        invoked = true;
        return Promise.resolve();
      },
    }),
  );
  await assert.rejects(
    client.call("requestContact", undefined),
    (error) => error instanceof MiniAppError && error.code === "unsupported",
  );
  assert.equal(invoked, false);
});

test("close and selection haptic are public canonical operations", async () => {
  const calls = [];
  const client = createMiniAppClient(
    adapter({
      capabilities: new Set(["close", "haptics"]),
      execute: (operation, input) => {
        calls.push([operation, input]);
        return Promise.resolve();
      },
    }),
  );
  await client.call("close", undefined);
  await client.call("haptic", { kind: "selection" });
  assert.deepEqual(calls, [
    ["close", undefined],
    ["haptic", { kind: "selection" }],
  ]);
});

test("listener registration and cleanup failures still settle requests", async () => {
  for (const failMethod of ["addEventListener", "removeEventListener"]) {
    const signal = new AbortController().signal;
    signal[failMethod] = () => {
      throw new Error("listener failure");
    };
    const client = createMiniAppClient(adapter());
    for (const pending of [
      client.call("readClipboard", undefined, { signal }),
      withHostCallback((finish) => finish(null, "value"), { signal }),
    ]) {
      if (failMethod === "addEventListener") {
        await assert.rejects(pending, (error) => error.code === "failed");
      } else {
        assert.equal(await pending, "value");
      }
    }
    client.dispose();
  }
});

test("invoice is an explicit capability with a normalized result", async () => {
  const client = createMiniAppClient(
    adapter({
      capabilities: new Set(["invoice"]),
      execute: (operation) =>
        Promise.resolve(operation === "openInvoice" ? "paid" : undefined),
    }),
  );
  assert.equal(
    await client.call("openInvoice", {
      url: "https://payments.example/invoice/1",
    }),
    "paid",
  );
});

test("device orientation sensors do not inherit screen-lock capability", async () => {
  let invoked = false;
  const client = createMiniAppClient(
    adapter({
      capabilities: new Set(["orientation"]),
      execute: () => {
        invoked = true;
        return Promise.resolve(true);
      },
    }),
  );
  await assert.rejects(
    client.call("startDeviceOrientation", {}, { timeoutMs: 10 }),
    (error) => error.code === "unsupported",
  );
  assert.equal(invoked, false);
});

test("normalizes adapter rejection", async () => {
  const client = createMiniAppClient(
    adapter({ execute: () => Promise.reject(new Error("native failure")) }),
  );
  await assert.rejects(
    client.call("readClipboard", undefined),
    (error) =>
      error instanceof MiniAppError &&
      error.code === "failed" &&
      error.message === "native failure",
  );
});

test("undefined rejection and thrown undefined remain failures", async () => {
  const rejected = createMiniAppClient(
    adapter({ execute: () => Promise.reject(undefined) }),
  );
  await assert.rejects(
    rejected.call("readClipboard", undefined),
    (error) => error.code === "failed",
  );
  const thrown = createMiniAppClient(
    adapter({
      execute: () => {
        throw undefined;
      },
    }),
  );
  await assert.rejects(
    thrown.call("readClipboard", undefined),
    (error) => error.code === "failed",
  );
  await assert.rejects(
    withHostCallback(() => {
      throw undefined;
    }),
    (error) => error.code === "failed",
  );
});

test("timeout cleans request and ignores a late result", async () => {
  let settle;
  let cleanups = 0;
  const client = createMiniAppClient(
    adapter({
      execute: () => ({
        promise: new Promise((resolve) => {
          settle = resolve;
        }),
        cleanup: () => cleanups++,
      }),
    }),
  );
  await assert.rejects(
    client.call("readClipboard", undefined, { timeoutMs: 5 }),
    (error) => error.code === "timeout",
  );
  settle("late");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cleanups, 1);
});

test("abort and disposal release pending work and listeners", async () => {
  let listenerReleases = 0;
  let requestReleases = 0;
  const client = createMiniAppClient(
    adapter({
      subscribe: () => () => listenerReleases++,
      execute: () => ({
        promise: new Promise(() => {}),
        cleanup: () => requestReleases++,
      }),
    }),
  );
  const off = client.on("activated", () => {});
  off();
  off();
  const pending = client.call("readClipboard", undefined);
  client.dispose();
  client.dispose();
  await assert.rejects(pending, (error) => error.code === "disposed");
  assert.equal(listenerReleases, 1);
  assert.equal(requestReleases, 1);
});

test("AbortSignal yields canonical aborted error", async () => {
  const controller = new AbortController();
  let adapterSignal;
  const client = createMiniAppClient(
    adapter({
      execute: (_operation, _input, context) => {
        adapterSignal = context.signal;
        return new Promise(() => {});
      },
    }),
  );
  const pending = client.call("readClipboard", undefined, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "aborted");
  assert.equal(adapterSignal.aborted, true);
});

test("callback helper runs cleanup after synchronous completion", async () => {
  let cleanups = 0;
  const value = await withHostCallback((finish) => {
    finish(null, "done");
    return () => cleanups++;
  });
  assert.equal(value, "done");
  assert.equal(cleanups, 1);
});

test("timeout and disposal abort promise-only adapter transports", async () => {
  let timeoutSignal;
  const timed = createMiniAppClient(
    adapter({
      execute: (_operation, _input, context) => {
        timeoutSignal = context.signal;
        return new Promise(() => {});
      },
    }),
  );
  await assert.rejects(
    timed.call("readClipboard", undefined, { timeoutMs: 5 }),
    (error) => error.code === "timeout",
  );
  assert.equal(timeoutSignal.aborted, true);

  let disposeSignal;
  const disposable = createMiniAppClient(
    adapter({
      execute: (_operation, _input, context) => {
        disposeSignal = context.signal;
        return new Promise(() => {});
      },
    }),
  );
  const pending = disposable.call("readClipboard", undefined);
  disposable.dispose();
  await assert.rejects(pending, (error) => error.code === "disposed");
  assert.equal(disposeSignal.aborted, true);
});

test("cleanup returned after synchronous disposal still runs", async () => {
  let client;
  let cleanupCount = 0;
  client = createMiniAppClient(
    adapter({
      execute: () => {
        client.dispose();
        return {
          promise: new Promise(() => {}),
          cleanup: () => cleanupCount++,
        };
      },
    }),
  );
  await assert.rejects(
    client.call("readClipboard", undefined),
    (error) => error.code === "disposed",
  );
  assert.equal(cleanupCount, 1);
});

test("disposal continues after a listener cleanup throws", () => {
  let subscribed = 0;
  let released = 0;
  const client = createMiniAppClient(
    adapter({
      subscribe: () => {
        const index = subscribed++;
        return () => {
          if (index === 0) throw new Error("broken cleanup");
          released++;
        };
      },
    }),
  );
  client.on("activated", () => {});
  client.on("deactivated", () => {});
  client.dispose();
  assert.equal(released, 1);
});

test("appearance binding releases earlier listeners when a later subscription fails", () => {
  let preferenceReleased = 0;
  let adapterReleased = 0;
  let subscriptions = 0;
  const client = createMiniAppClient(
    adapter({
      subscribe: () => {
        subscriptions++;
        if (subscriptions === 2) throw new MiniAppError("failed");
        return () => adapterReleased++;
      },
    }),
  );
  const environment = {
    root: { dataset: {}, style: { setProperty() {} } },
    prefersDark: () => false,
    background: () => "",
    onPreferenceChange: () => () => preferenceReleased++,
  };
  assert.throws(
    () => bindAppearance(client, environment),
    (error) => error.code === "failed",
  );
  assert.equal(preferenceReleased, 1);
  assert.equal(adapterReleased, 1);
});

test("appearance binding does not invoke lifecycle operations", () => {
  let calls = 0;
  const client = createMiniAppClient(
    adapter({
      capabilities: new Set(["ready", "expand"]),
      execute: () => {
        calls++;
        return Promise.resolve();
      },
    }),
  );
  const release = bindAppearance(client, {
    root: { dataset: {}, style: { setProperty() {} } },
    prefersDark: () => false,
    background: () => "",
    onPreferenceChange: () => () => {},
  });
  release();
  assert.equal(calls, 0);
});

test("appearance uses snapshots and available events when host events are optional", () => {
  for (const available of [[], ["themeChanged"]]) {
    let snapshot = { colorScheme: "dark", safeArea: { top: 12 } };
    const listeners = new Map();
    let preferenceChanged;
    let preferenceReleased = 0;
    const client = createMiniAppClient(
      adapter({
        snapshot: () => snapshot,
        subscribe(event, listener) {
          if (!available.includes(event)) throw new MiniAppError("unsupported");
          listeners.set(event, listener);
          return () => listeners.delete(event);
        },
      }),
    );
    const properties = new Map();
    const root = {
      dataset: {},
      style: { setProperty: (key, value) => properties.set(key, value) },
    };
    const release = bindAppearance(client, {
      root,
      prefersDark: () => false,
      background: () => "",
      onPreferenceChange(listener) {
        preferenceChanged = listener;
        return () => preferenceReleased++;
      },
    });
    assert.equal(root.dataset.theme, "dark");
    assert.equal(properties.get("--host-top"), "12px");
    snapshot = { colorScheme: "light", safeArea: { top: 20 } };
    if (available.length) listeners.get("themeChanged")();
    else preferenceChanged();
    assert.equal(root.dataset.theme, "light");
    assert.equal(properties.get("--host-top"), "20px");
    release();
    assert.equal(listeners.size, 0);
    assert.equal(preferenceReleased, 1);
    client.dispose();
  }
});
test("appearance sums cutout and content insets and stays inert after one disposal", () => {
  const properties = new Map();
  let onPreference,
    cleanups = 0;
  const client = createMiniAppClient(
    adapter({
      snapshot: () => ({
        safeArea: { top: 20, bottom: 10 },
        contentSafeArea: { top: 44, bottom: 5 },
      }),
    }),
  );
  const release = bindAppearance(client, {
    root: {
      dataset: {},
      style: { setProperty: (k, v) => properties.set(k, v) },
    },
    prefersDark: () => false,
    background: () => "",
    onPreferenceChange: (fn) => {
      onPreference = fn;
      return () => cleanups++;
    },
  });
  assert.equal(properties.get("--host-top"), "64px");
  assert.equal(properties.get("--host-bottom"), "15px");
  release();
  release();
  properties.clear();
  onPreference();
  assert.equal(cleanups, 1);
  assert.equal(properties.size, 0);
  client.dispose();
});
test("appearance without host insets preserves existing CSS fallback values", () => {
  const properties = new Map([["--host-top", "env(safe-area-inset-top)"]]);
  const client = createMiniAppClient(adapter({ snapshot: () => ({}) }));
  const release = bindAppearance(client, {
    root: {
      dataset: {},
      style: { setProperty: (k, v) => properties.set(k, v) },
    },
    prefersDark: () => false,
    background: () => "",
    onPreferenceChange: () => () => {},
  });
  assert.equal(properties.get("--host-top"), "env(safe-area-inset-top)");
  assert.equal(properties.has("--host-bottom"), false);
  release();
  client.dispose();
});

test("rechecks an external signal after installing its listener", async () => {
  let reads = 0;
  let invoked = false;
  const signal = {
    get aborted() {
      reads++;
      return reads >= 2;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const client = createMiniAppClient(
    adapter({
      execute: () => {
        invoked = true;
        return Promise.resolve();
      },
    }),
  );
  await assert.rejects(
    client.call("readClipboard", undefined, { signal }),
    (error) => error.code === "aborted",
  );
  assert.equal(invoked, false);
});

test("timer bounds reject fractional and overflowing delays", async () => {
  const client = createMiniAppClient(adapter());
  for (const timeoutMs of [1.5, 2_147_483_648]) {
    await assert.rejects(
      client.call("readClipboard", undefined, { timeoutMs }),
      RangeError,
    );
    await assert.rejects(
      withHostCallback(() => {}, { timeoutMs }),
      RangeError,
    );
  }
});

test("shareToStory reports validation errors as promise rejections", async () => {
  const client = createMiniAppClient(
    adapter({ capabilities: new Set(["shareToStory"]) }),
  );
  const result = shareToStory(client, "file:///private/story.png");
  assert.equal(result instanceof Promise, true);
  await assert.rejects(result, TypeError);
});

test("signal registration races release listeners without starting host work", async () => {
  let starts = 0;
  for (const start of [
    (signal) =>
      createMiniAppClient(
        adapter({
          execute: () => {
            starts++;
            return Promise.resolve();
          },
        }),
      ).call("readClipboard", undefined, { signal }),
    (signal) =>
      withHostCallback(
        () => {
          starts++;
        },
        { signal },
      ),
  ]) {
    for (const mode of ["throw", "cancel"]) {
      let installed = false;
      let removed = 0;
      const signal = {
        get aborted() {
          if (installed && mode === "throw") throw new Error("signal read");
          return false;
        },
        addEventListener(_event, listener) {
          installed = true;
          if (mode === "cancel") listener();
        },
        removeEventListener() {
          removed++;
        },
      };
      await assert.rejects(start(signal));
      assert.equal(removed, 1);
    }
  }
  assert.equal(starts, 0);
});
