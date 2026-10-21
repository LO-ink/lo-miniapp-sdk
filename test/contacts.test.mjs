import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  createContactsRequest,
  verifyContactsRequest,
  verifyContactsProof,
  contactsBatches,
} from "../dist/server.js";
import { createMiniAppClient, requestContactsProof } from "../dist/index.js";
const f = JSON.parse(
  readFileSync(
    new URL("../go/contacts/testdata/proof.json", import.meta.url),
    "utf8",
  ),
);
const options = {
  appKey: f.appKey,
  appId: f.requestPayload.app_id,
  userId: "101",
  nowSec: f.nowSec,
};
function signed(payload, kind = "proof", body = JSON.stringify(payload)) {
  const b = Buffer.from(body).toString("base64url");
  const key = createHmac("sha256", f.appKey)
    .update(kind === "proof" ? "LOContactsProof/v1" : "LOContactsRequest/v1")
    .digest();
  return b + "." + createHmac("sha256", key).update(b).digest("base64url");
}
test("shared Go/Node fixture, subset, complete empty result and disjoint batches", () => {
  assert.equal(
    createContactsRequest({
      ...options,
      nowSec: f.requestPayload.iat,
      candidateIds: ["202", "303"],
      nonce: f.requestPayload.nonce,
    }),
    f.request,
  );
  assert.deepEqual(verifyContactsRequest(f.request, options), f.requestPayload);
  assert.deepEqual(
    verifyContactsProof(f.proof, { ...options, request: f.request }),
    f.proofPayload,
  );
  assert.deepEqual(
    verifyContactsProof(signed({ ...f.proofPayload, ids: [] }), {
      ...options,
      request: f.request,
    }).ids,
    [],
  );
  assert.deepEqual(contactsBatches([]), []);
  assert.deepEqual(contactsBatches(["1", "2", "1"]), [["1", "2"]]);
  const ids = Array.from({ length: 401 }, (_, i) => String(i + 1));
  assert.deepEqual(
    contactsBatches(ids).map((b) => b.length),
    [200, 200, 1],
  );
  const fresh = createContactsRequest({
    ...options,
    nowSec: undefined,
    candidateIds: ["9223372036854775807"],
  });
  assert.equal(
    verifyContactsRequest(fresh, { ...options, nowSec: undefined }).nonce
      .length,
    22,
  );
});
test("proof cannot move between users, apps, queries, token domains or expiry windows", () => {
  for (const changes of [
    { app_id: "00000000-0000-0000-0000-000000000000" },
    { user_id: "202" },
    { nonce: "AQECAwQFBgcICQoLDA0ODw" },
    { request_hash: "0".repeat(64) },
    { ids: ["404"] },
    { ids: ["202", "202"] },
    { ids: ["0"] },
    { ids: ["9223372036854775808"] },
    { ids: null },
    { iat: 1700000200 },
    { iat: 1700000010.5 },
    { exp: 1700000020 },
    { exp: 1700000131 },
    { iat: 1699999969, exp: 1700000040 },
    { v: 2 },
    { extra: true },
    { request_hash: "bad" },
  ]) {
    assert.throws(
      () =>
        verifyContactsProof(signed({ ...f.proofPayload, ...changes }), {
          ...options,
          request: f.request,
        }),
      undefined,
      JSON.stringify(changes),
    );
  }
  assert.throws(() =>
    verifyContactsProof(signed(f.proofPayload, "request"), {
      ...options,
      request: f.request,
    }),
  );
  assert.throws(() =>
    verifyContactsProof(f.proof, {
      ...options,
      appKey: "wrong",
      request: f.request,
    }),
  );
  assert.throws(() =>
    verifyContactsProof(f.proof, {
      ...options,
      request: createContactsRequest({
        ...options,
        candidateIds: ["202"],
        nonce: f.requestPayload.nonce,
      }),
    }),
  );
  assert.throws(() =>
    verifyContactsRequest(f.request, { ...options, nowSec: 1700000120 }),
  );
});
test("bounded parsers reject malformed values, duplicate keys and ambiguous encodings", () => {
  const verify = (raw) =>
    verifyContactsProof(raw, { ...options, request: f.request });
  for (const raw of [
    "",
    null,
    "x".repeat(17000),
    "a.b.c",
    "a." + "A".repeat(43),
    f.proof + "=",
    f.proof.slice(0, -1) + "A",
    signed(null),
    signed([]),
    signed({}, "proof", '{"v":1,"v":1}'),
    signed({}, "proof", "invalid"),
    signed({ ...f.proofPayload, nonce: "A".repeat(21) + "B" }),
  ])
    assert.throws(() => verify(raw));
  for (const field of Object.keys(f.proofPayload)) {
    const p = { ...f.proofPayload };
    delete p[field];
    assert.throws(() => verify(signed(p)));
  }
  for (const changes of [
    { candidateIds: [] },
    { candidateIds: ["202", "202"] },
    { candidateIds: Array(201).fill("202") },
    { candidateIds: [1] },
    { candidateIds: ["-1"] },
    { candidateIds: ["01"] },
    { nonce: "bad" },
    { ttlSec: 0 },
    { ttlSec: 121 },
    { ttlSec: 1.5 },
    { appId: "bad" },
    { appKey: "" },
    { userId: "0" },
    { nowSec: -1 },
    { nowSec: NaN },
  ])
    assert.throws(() =>
      createContactsRequest({ ...options, candidateIds: ["202"], ...changes }),
    );
  for (const p of [
    { ...f.requestPayload, candidate_ids: [] },
    { ...f.requestPayload, candidate_ids: ["202", "202"] },
    { ...f.requestPayload, candidate_ids: null },
  ])
    assert.throws(() => verifyContactsRequest(signed(p, "request"), options));
  assert.throws(() => contactsBatches(["0"]));
  assert.throws(() => contactsBatches(null));
});
test("contacts helper preserves unsupported, consent denial and cancellation", async () => {
  let count = 0;
  const client = createMiniAppClient({
    id: "lo",
    launchData: "",
    capabilities: new Set(["requestContactsProof"]),
    snapshot: () => ({}),
    subscribe: () => () => {},
    execute: async (op, input) => {
      count++;
      assert.equal(op, "requestContactsProof");
      assert.deepEqual(input, { request: f.request });
      return { proof: f.proof };
    },
  });
  assert.deepEqual(await requestContactsProof(client, { request: f.request }), {
    proof: f.proof,
  });
  for (const request of ["", null, "x".repeat(17000), "bad"])
    await assert.rejects(requestContactsProof(client, { request }));
  await assert.rejects(requestContactsProof(client, null));
  assert.equal(count, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    requestContactsProof(
      client,
      { request: f.request },
      { signal: abort.signal },
    ),
    { code: "aborted" },
  );
  client.dispose();
  await assert.rejects(requestContactsProof(client, { request: f.request }), {
    code: "disposed",
  });
  const old = createMiniAppClient({
    id: "lo",
    launchData: "",
    capabilities: new Set(),
    snapshot: () => ({}),
    subscribe: () => () => {},
    execute: async () => {
      throw Error("must not call");
    },
  });
  await assert.rejects(requestContactsProof(old, { request: f.request }), {
    code: "unsupported",
  });
  old.dispose();
});
