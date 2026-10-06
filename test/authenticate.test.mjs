import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../dist/index.js";

function fixture(launchData = "signed-launch", id = "lo") {
  const entries = new Map();
  const adapter = { id, launchData };
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  let authentications = 0;
  const options = {
    storageKey: "session",
    storage,
    authenticate: async (launch) => {
      assert.deepEqual(launch, { adapterId: id, launchData });
      authentications += 1;
      return { token: `session-${authentications}`, startParam: "game" };
    },
    validate: async () => {},
    isUnauthorized: (error) => error.code === "unauthorized",
  };
  return { adapter, entries, options, count: () => authentications };
}

test("cached sessions require the same signed launch, adapter identity and server validation", async () => {
  const f = fixture();
  const first = await authenticate(f.adapter, f.options);
  let validated;
  f.options.validate = async (token) => {
    validated = token;
  };
  assert.deepEqual(await authenticate(f.adapter, f.options), first);
  assert.equal(validated, first.token);
  assert.equal(f.count(), 1);
  const originalCache = f.entries.get("session");
  await authenticate(
    { ...f.adapter, launchData: "different-launch" },
    {
      ...f.options,
      authenticate: async () => ({ token: "fresh", startParam: "" }),
    },
  );
  assert.equal(validated, first.token);
  const other = fixture("signed-launch", "other-provider");
  other.entries.set("session", originalCache);
  await authenticate(other.adapter, other.options);
  assert.equal(other.count(), 1);
});

test("confirmed expired sessions authenticate again; validation outages propagate", async () => {
  const f = fixture();
  await authenticate(f.adapter, f.options);
  f.options.validate = async () => {
    throw Object.assign(new Error("Expired"), { code: "unauthorized" });
  };
  assert.equal((await authenticate(f.adapter, f.options)).token, "session-2");
  const outage = new Error("Server unavailable");
  f.options.validate = async () => {
    throw outage;
  };
  await assert.rejects(
    authenticate(f.adapter, f.options),
    (error) => error === outage,
  );
  assert.equal(f.count(), 2);
});

test("malformed cache and unavailable optional storage never establish identity", async () => {
  for (const cached of [
    "not JSON",
    "{}",
    JSON.stringify({ token: "forged", startParam: "" }),
  ]) {
    const f = fixture();
    f.entries.set("session", cached);
    assert.equal((await authenticate(f.adapter, f.options)).token, "session-1");
  }
  const f = fixture();
  const storage = {
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Quota");
    },
  };
  assert.equal(
    (await authenticate(f.adapter, { ...f.options, storage })).token,
    "session-1",
  );
  assert.equal(
    (await authenticate(f.adapter, { ...f.options, storage: null })).token,
    "session-2",
  );
});

test("invalid server sessions are rejected and cannot enter the cache", async () => {
  for (const session of [
    { token: "", startParam: "" },
    { token: "valid" },
    { token: 42, startParam: "" },
  ]) {
    const f = fixture();
    await assert.rejects(
      authenticate(f.adapter, {
        ...f.options,
        authenticate: async () => session,
      }),
      TypeError,
    );
    assert.equal(f.entries.size, 0);
  }
});
