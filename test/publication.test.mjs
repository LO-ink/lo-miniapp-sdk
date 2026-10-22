import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  createPublicationRequest,
  verifyPublicationRequest,
  signPublicationProof,
  verifyPublicationProof,
  publicationReference,
} from "../dist/server.js";
const f = JSON.parse(
  readFileSync(
    new URL("../go/publication/testdata/proof.json", import.meta.url),
    "utf8",
  ),
);
const options = {
  appId: f.requestPayload.appId,
  appKey: f.appKey,
  userId: f.requestPayload.userId,
  nowSec: f.nowSec,
};
function signed(payload, kind = "proof", text = JSON.stringify(payload)) {
  const body = Buffer.from(text).toString("base64url");
  const key = createHmac("sha256", f.appKey)
    .update(
      kind === "proof" ? "LOPublicationProof/v1" : "LOPublicationRequest/v1",
    )
    .digest();
  return (
    body + "." + createHmac("sha256", key).update(body).digest("base64url")
  );
}
test("publication shared fixture and seven-day durable recovery bind actual object and short proof", () => {
  assert.equal(
    createPublicationRequest({
      ...options,
      nowSec: f.requestPayload.iat,
      nonce: f.requestPayload.nonce,
      kind: "moment",
    }),
    f.request,
  );
  assert.deepEqual(
    verifyPublicationRequest(f.request, options),
    f.requestPayload,
  );
  assert.deepEqual(
    verifyPublicationProof(f.proof, { ...options, request: f.request }),
    f.proofPayload,
  );
  assert.equal(
    signPublicationProof(
      f.request,
      {
        publicationId: "9001",
        publishedAt: 1700000005,
        appUrl: f.proofPayload.appUrl,
      },
      options,
    ),
    f.proof,
  );
  assert.equal(publicationReference(f.request), f.proofPayload.requestHash);
  const late = { ...options, nowSec: f.requestPayload.exp - 1 };
  const recovered = signPublicationProof(
    f.request,
    {
      publicationId: "9001",
      publishedAt: 1700000005,
      appUrl: f.proofPayload.appUrl,
    },
    late,
  );
  assert.equal(
    verifyPublicationProof(recovered, { ...late, request: f.request }).exp,
    f.requestPayload.exp,
  );
  assert.throws(() =>
    verifyPublicationProof(recovered, {
      ...late,
      nowSec: f.requestPayload.exp,
      request: f.request,
    }),
  );
  const fresh = createPublicationRequest({
    ...options,
    nowSec: undefined,
    nonce: f.requestPayload.nonce,
    kind: "post",
    ttlSec: 60,
  });
  assert.equal(
    verifyPublicationRequest(fresh, { ...options, nowSec: undefined }).kind,
    "post",
  );
});
test("publication rejects forged context, old objects, absent links, malformed signed shapes and ambiguous JSON", () => {
  for (const change of [
    { v: 2 },
    { appId: "other" },
    { userId: "202" },
    { nonce: "AQECAwQFBgcICQoLDA0ODw" },
    { kind: "post" },
    { requestHash: "0".repeat(64) },
    { publicationId: "0" },
    { publicationId: "9223372036854775808" },
    { publishedAt: f.requestPayload.iat - 1 },
    { publishedAt: f.nowSec + 1 },
    { publishedAt: 1.5 },
    { appUrl: "https://lo.ink/app/other" },
    { iat: f.nowSec + 31 },
    { iat: -1 },
    { iat: f.requestPayload.iat - 1 },
    { exp: f.nowSec },
    { exp: f.nowSec + 301 },
    { extra: true },
    { nonce: "bad" },
  ])
    assert.throws(() =>
      verifyPublicationProof(signed({ ...f.proofPayload, ...change }), {
        ...options,
        request: f.request,
      }),
    );
  for (const text of [
    "null",
    "[]",
    "{}",
    "{bad",
    '{"v":1,"v":1}',
    JSON.stringify(f.proofPayload).replace(
      '"kind":',
      '"kind":"moment","kind":',
    ),
  ])
    assert.throws(() =>
      verifyPublicationProof(signed(null, "proof", text), {
        ...options,
        request: f.request,
      }),
    );
  for (const raw of [
    "",
    null,
    1,
    "x".repeat(4097),
    "a.b.c",
    f.proof + "=",
    f.proof.slice(0, -1) + "A",
  ])
    assert.throws(() =>
      verifyPublicationProof(raw, { ...options, request: f.request }),
    );
  assert.throws(() =>
    verifyPublicationProof(f.proof, {
      ...options,
      appKey: "wrong",
      request: f.request,
    }),
  );
  assert.throws(() =>
    verifyPublicationProof(f.proof, { ...options, request: "bad" }),
  );
  for (const request of ["", 1, "x".repeat(4097)])
    assert.throws(() => publicationReference(request));
  for (const change of [
    { nonce: "bad" },
    { kind: "other" },
    { ttlSec: 0 },
    { ttlSec: 604801 },
    { ttlSec: 1.5 },
    { appKey: "" },
    { appId: "bad" },
    { userId: "0" },
    { nowSec: -1 },
    { nowSec: Number.MAX_SAFE_INTEGER },
  ])
    assert.throws(() =>
      createPublicationRequest({
        ...options,
        kind: "post",
        nonce: f.requestPayload.nonce,
        ...change,
      }),
    );
  for (const change of [
    { publicationId: "0" },
    { publishedAt: f.requestPayload.iat - 1 },
    { publishedAt: f.nowSec + 1 },
    { appUrl: "https://example.com/" },
  ])
    assert.throws(() =>
      signPublicationProof(
        f.request,
        {
          publicationId: "9001",
          publishedAt: f.nowSec,
          appUrl: f.proofPayload.appUrl,
          ...change,
        },
        options,
      ),
    );
});
