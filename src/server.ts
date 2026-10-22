import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  decodeLaunchParams,
  DuplicateLaunchParameter,
  launchDataFromParams,
  type LaunchData,
} from "./launch.js";

export type InitDataErrorCode =
  | "invalid-data"
  | "invalid-signature"
  | "wrong-app-id"
  | "expired"
  | "future-auth-date"
  | "duplicate-parameter";
export class InitDataError extends Error {
  constructor(readonly code: InitDataErrorCode) {
    super(code);
    this.name = "InitDataError";
  }
}
export interface VerifyInitDataOptions {
  /** LO Connect app key, exactly as supplied; never base64-decode it. */
  appKey: string;
  appId: string;
  maxAgeSec: number;
  /** Clock override for deterministic tests. Defaults to current Unix seconds. */
  nowSec?: number;
}
export interface VerifiedInitData extends LaunchData {
  readonly authDate: number;
  readonly appId: string;
}
/** Verify registered-app data on the server. Import only from /server. */
export function verifyInitData(
  raw: string,
  options: VerifyInitDataOptions,
): VerifiedInitData {
  if (
    !options ||
    typeof options.appKey !== "string" ||
    !options.appKey ||
    typeof options.appId !== "string" ||
    !options.appId ||
    !Number.isSafeInteger(options.maxAgeSec) ||
    options.maxAgeSec < 0
  )
    throw new TypeError(
      "Expected appKey, appId and a non-negative integer maxAgeSec",
    );
  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < 0)
    throw new TypeError("Invalid clock");
  let params: Map<string, string>;
  try {
    params = decodeLaunchParams(raw);
  } catch (error) {
    throw new InitDataError(
      error instanceof DuplicateLaunchParameter
        ? "duplicate-parameter"
        : "invalid-data",
    );
  }
  const hash = params.get("hash");
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash))
    throw new InitDataError("invalid-signature");
  const joined = [...params]
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => {
      const x = new TextEncoder().encode(a);
      const y = new TextEncoder().encode(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        if (x[i] !== y[i]) return x[i] - y[i];
      }
      return x.length - y.length;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(options.appKey)
    .digest();
  const expected = createHmac("sha256", secret).update(joined).digest();
  const actual = Uint8Array.from(hash.match(/../g)!, (part) =>
    parseInt(part, 16),
  );
  if (!timingSafeEqual(expected, actual))
    throw new InitDataError("invalid-signature");
  if (params.get("app_id") !== options.appId)
    throw new InitDataError("wrong-app-id");
  const date = params.get("auth_date");
  if (!date || !/^[0-9]+$/.test(date) || !Number.isSafeInteger(Number(date)))
    throw new InitDataError("invalid-data");
  const authDate = Number(date);
  if (authDate > now + 300) throw new InitDataError("future-auth-date");
  if (now - authDate > options.maxAgeSec) throw new InitDataError("expired");
  try {
    return { ...launchDataFromParams(params), authDate, appId: options.appId };
  } catch {
    throw new InitDataError("invalid-data");
  }
}

/** Contacts requests never enumerate the user's complete social graph. */
export const CONTACTS_MAX_CANDIDATES = 200;
export const CONTACTS_MAX_TOKEN_BYTES = 16_384;
export const CONTACTS_MAX_TTL_SECONDS = 120;
const contactDomains = {
  request: "LOContactsRequest/v1",
  proof: "LOContactsProof/v1",
} as const;
export interface ContactsRequest {
  v: 1;
  app_id: string;
  user_id: string;
  iat: number;
  exp: number;
  nonce: string;
  candidate_ids: string[];
}
export interface ContactsProof {
  v: 1;
  app_id: string;
  user_id: string;
  iat: number;
  exp: number;
  nonce: string;
  request_hash: string;
  ids: string[];
}
export interface ContactsOptions {
  appKey: string;
  appId: string;
  userId: string;
  nowSec?: number;
}
export interface CreateContactsOptions extends ContactsOptions {
  candidateIds: readonly string[];
  nonce?: string;
  ttlSec?: number;
}
export class ContactsProofError extends Error {
  constructor(
    readonly code:
      | "invalid-data"
      | "invalid-signature"
      | "wrong-context"
      | "expired"
      | "invalid-time",
  ) {
    super(code);
    this.name = "ContactsProofError";
  }
}
function contactID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
function contactList(value: unknown, empty = false): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= CONTACTS_MAX_CANDIDATES &&
    (empty || value.length > 0) &&
    value.every(contactID) &&
    new Set(value).size === value.length
  );
}
/** Split only your own app's participants. Empty input makes no host request. */
export function contactsBatches(ids: readonly string[]): string[][] {
  if (!Array.isArray(ids) || !ids.every(contactID))
    throw new ContactsProofError("invalid-data");
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += CONTACTS_MAX_CANDIDATES)
    batches.push(unique.slice(i, i + CONTACTS_MAX_CANDIDATES));
  return batches;
}
function contactsContext(options: ContactsOptions): number {
  const now = options?.nowSec ?? Math.floor(Date.now() / 1000);
  if (
    !options ||
    typeof options.appKey !== "string" ||
    !options.appKey ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      options.appId,
    ) ||
    !contactID(options.userId) ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new ContactsProofError("invalid-data");
  return now;
}
function contactsMAC(
  body: string,
  appKey: string,
  kind: keyof typeof contactDomains,
): Buffer {
  const key = createHmac("sha256", appKey)
    .update(contactDomains[kind])
    .digest();
  return createHmac("sha256", key).update(body).digest();
}
function contactsEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function contactsDecode(value: string): Uint8Array {
  try {
    return Uint8Array.from(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
  } catch {
    throw new ContactsProofError("invalid-data");
  }
}
function contactsSign(payload: ContactsRequest, appKey: string): string {
  const body = contactsEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return (
    body + "." + contactsMAC(body, appKey, "request").toString("base64url")
  );
}
function contactsRead(
  raw: string,
  options: ContactsOptions,
  kind: keyof typeof contactDomains,
): Record<string, unknown> {
  const now = contactsContext(options);
  if (
    typeof raw !== "string" ||
    raw.length > CONTACTS_MAX_TOKEN_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)
  )
    throw new ContactsProofError("invalid-data");
  const [body, signature] = raw.split(".");
  const bytes = contactsDecode(body),
    sig = contactsDecode(signature);
  if (contactsEncode(bytes) !== body || contactsEncode(sig) !== signature)
    throw new ContactsProofError("invalid-data");
  if (!timingSafeEqual(sig, contactsMAC(body, options.appKey, kind)))
    throw new ContactsProofError("invalid-signature");
  let data: Record<string, unknown>;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) =>
      JSON.parse('"' + match[1] + '"'),
    );
    if (new Set(keys).size !== keys.length) throw new Error();
  } catch {
    throw new ContactsProofError("invalid-data");
  }
  const fields =
    kind === "request"
      ? ["v", "app_id", "user_id", "iat", "exp", "nonce", "candidate_ids"]
      : [
          "v",
          "app_id",
          "user_id",
          "iat",
          "exp",
          "nonce",
          "request_hash",
          "ids",
        ];
  if (
    Object.keys(data).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(data, key)) ||
    data.v !== 1 ||
    typeof data.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(data.nonce) ||
    contactsEncode(contactsDecode(data.nonce)) !== data.nonce
  )
    throw new ContactsProofError("invalid-data");
  if (data.app_id !== options.appId || data.user_id !== options.userId)
    throw new ContactsProofError("wrong-context");
  const { iat, exp } = data;
  if (
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp) ||
    iat < 0 ||
    exp <= iat ||
    exp - iat > CONTACTS_MAX_TTL_SECONDS ||
    iat > now + 30
  )
    throw new ContactsProofError("invalid-time");
  if (exp <= now) throw new ContactsProofError("expired");
  if (
    kind === "request"
      ? !contactList(data.candidate_ids)
      : !contactList(data.ids, true) ||
        typeof data.request_hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(data.request_hash)
  )
    throw new ContactsProofError("invalid-data");
  return data;
}
export function createContactsRequest(options: CreateContactsOptions): string {
  const now = contactsContext(options),
    ttl = options.ttlSec ?? CONTACTS_MAX_TTL_SECONDS;
  const nonce = options.nonce ?? randomBytes(16).toString("base64url");
  if (
    !Number.isSafeInteger(ttl) ||
    ttl <= 0 ||
    ttl > CONTACTS_MAX_TTL_SECONDS ||
    !contactList(options.candidateIds) ||
    typeof nonce !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(nonce) ||
    contactsEncode(contactsDecode(nonce)) !== nonce
  )
    throw new ContactsProofError("invalid-data");
  return contactsSign(
    {
      v: 1,
      app_id: options.appId,
      user_id: options.userId,
      iat: now,
      exp: now + ttl,
      nonce,
      candidate_ids: [...options.candidateIds],
    },
    options.appKey,
  );
}
/** For platform-side integrations; expected user/app must come from authenticated context. */
export function verifyContactsRequest(
  raw: string,
  options: ContactsOptions,
): ContactsRequest {
  return contactsRead(raw, options, "request") as unknown as ContactsRequest;
}
/** Verify every batch of a server-owned snapshot before publishing its complete ranking. */
export function verifyContactsProof(
  raw: string,
  options: ContactsOptions & { request: string },
): ContactsProof {
  const request = verifyContactsRequest(options.request, options);
  const proof = contactsRead(raw, options, "proof") as unknown as ContactsProof;
  if (
    proof.nonce !== request.nonce ||
    proof.request_hash !==
      createHash("sha256").update(options.request).digest("hex") ||
    proof.exp > request.exp ||
    proof.iat < request.iat - 30 ||
    proof.ids.some((id) => !request.candidate_ids.includes(id))
  )
    throw new ContactsProofError("wrong-context");
  return proof;
}

export const PUBLICATION_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PUBLICATION_PROOF_TTL_SECONDS = 300;
export const PUBLICATION_MAX_TOKEN_BYTES = 4096;
export type PublicationKind = "post" | "moment";
export interface PublicationOptions {
  appId: string;
  appKey: string;
  userId: string;
  nowSec?: number;
}
export interface PublicationRequest {
  v: 1;
  appId: string;
  userId: string;
  nonce: string;
  kind: PublicationKind;
  iat: number;
  exp: number;
}
export interface PublicationProof extends PublicationRequest {
  requestHash: string;
  publicationId: string;
  publishedAt: number;
  appUrl: string;
}
export class PublicationProofError extends Error {
  constructor(
    readonly code:
      | "invalid-data"
      | "invalid-signature"
      | "wrong-context"
      | "expired"
      | "invalid-time",
  ) {
    super(code);
    this.name = "PublicationProofError";
  }
}
function publicationEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function publicationDecode(value: string): Uint8Array {
  try {
    return Uint8Array.from(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
  } catch {
    throw new PublicationProofError("invalid-data");
  }
}
const domains = {
  request: "LOPublicationRequest/v1",
  proof: "LOPublicationProof/v1",
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
function context(options: PublicationOptions): number {
  const now = options?.nowSec ?? Math.floor(Date.now() / 1000);
  if (
    !options ||
    typeof options.appKey !== "string" ||
    !options.appKey ||
    typeof options.appId !== "string" ||
    !uuid.test(options.appId) ||
    !validID(options.userId) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > Number.MAX_SAFE_INTEGER - PUBLICATION_MAX_TTL_SECONDS
  )
    throw new PublicationProofError("invalid-data");
  return now;
}
function nonceValid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(value) &&
    publicationEncode(publicationDecode(value)) === value
  );
}
function mac(body: string, key: string, kind: keyof typeof domains): Buffer {
  const derived = createHmac("sha256", key).update(domains[kind]).digest();
  return createHmac("sha256", derived).update(body).digest();
}
function sign(
  payload: PublicationRequest | PublicationProof,
  key: string,
  kind: keyof typeof domains,
): string {
  const body = publicationEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return body + "." + mac(body, key, kind).toString("base64url");
}
/** Stable opaque owner lookup key. Never use a media-upload receipt as publication proof. */
export function publicationReference(request: string): string {
  if (
    typeof request !== "string" ||
    request.length > PUBLICATION_MAX_TOKEN_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(request)
  )
    throw new PublicationProofError("invalid-data");
  return createHash("sha256")
    .update("LOPublicationReference/v1\n" + request)
    .digest("hex");
}
function read(
  raw: string,
  options: PublicationOptions,
  kind: keyof typeof domains,
): PublicationRequest | PublicationProof {
  const now = context(options);
  if (
    typeof raw !== "string" ||
    raw.length > PUBLICATION_MAX_TOKEN_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)
  )
    throw new PublicationProofError("invalid-data");
  const [body, signature] = raw.split(".");
  const bytes = publicationDecode(body),
    sig = publicationDecode(signature);
  if (publicationEncode(bytes) !== body || publicationEncode(sig) !== signature)
    throw new PublicationProofError("invalid-data");
  if (!timingSafeEqual(sig, mac(body, options.appKey, kind)))
    throw new PublicationProofError("invalid-signature");
  let data: Record<string, unknown>;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((match) =>
      JSON.parse('"' + match[1] + '"'),
    );
    if (new Set(keys).size !== keys.length) throw new Error();
  } catch {
    throw new PublicationProofError("invalid-data");
  }
  const fields = [
    "v",
    "appId",
    "userId",
    "nonce",
    "kind",
    "iat",
    "exp",
    ...(kind === "proof"
      ? ["requestHash", "publicationId", "publishedAt", "appUrl"]
      : []),
  ];
  if (
    Object.keys(data).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(data, key)) ||
    data.v !== 1 ||
    !nonceValid(data.nonce) ||
    (data.kind !== "post" && data.kind !== "moment")
  )
    throw new PublicationProofError("invalid-data");
  if (data.appId !== options.appId || data.userId !== options.userId)
    throw new PublicationProofError("wrong-context");
  const { iat, exp } = data;
  if (
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp) ||
    iat < 0 ||
    exp <= iat ||
    exp - iat >
      (kind === "request"
        ? PUBLICATION_MAX_TTL_SECONDS
        : PUBLICATION_PROOF_TTL_SECONDS) ||
    iat > now + 30
  )
    throw new PublicationProofError("invalid-time");
  if (exp <= now) throw new PublicationProofError("expired");
  if (
    kind === "proof" &&
    (typeof data.requestHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(data.requestHash) ||
      !validID(data.publicationId) ||
      typeof data.publishedAt !== "number" ||
      !Number.isSafeInteger(data.publishedAt) ||
      data.publishedAt < 0 ||
      data.publishedAt > iat ||
      data.appUrl !== "https://lo.ink/app/" + options.appId)
  )
    throw new PublicationProofError("invalid-data");
  return data as unknown as PublicationRequest | PublicationProof;
}
export function createPublicationRequest(
  options: PublicationOptions & {
    nonce: string;
    kind: PublicationKind;
    ttlSec?: number;
  },
): string {
  const now = context(options),
    ttl = options.ttlSec ?? PUBLICATION_MAX_TTL_SECONDS;
  if (
    !nonceValid(options.nonce) ||
    (options.kind !== "post" && options.kind !== "moment") ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1 ||
    ttl > PUBLICATION_MAX_TTL_SECONDS
  )
    throw new PublicationProofError("invalid-data");
  return sign(
    {
      v: 1,
      appId: options.appId,
      userId: options.userId,
      nonce: options.nonce,
      kind: options.kind,
      iat: now,
      exp: now + ttl,
    },
    options.appKey,
    "request",
  );
}
/** Expected identity must come from the authenticated registered-app launch. */
export function verifyPublicationRequest(
  raw: string,
  options: PublicationOptions,
): PublicationRequest {
  return read(raw, options, "request") as PublicationRequest;
}
/** Trusted platform issuer only, after checking the real authored publication and its link. */
export function signPublicationProof(
  request: string,
  publication: { publicationId: string; publishedAt: number; appUrl: string },
  options: PublicationOptions,
): string {
  const verified = verifyPublicationRequest(request, options),
    now = context(options);
  if (
    !validID(publication.publicationId) ||
    !Number.isSafeInteger(publication.publishedAt) ||
    publication.publishedAt < verified.iat ||
    publication.publishedAt > verified.exp ||
    publication.publishedAt > now ||
    publication.appUrl !== "https://lo.ink/app/" + options.appId
  )
    throw new PublicationProofError("wrong-context");
  const proof: PublicationProof = {
    ...verified,
    iat: now,
    exp: Math.min(now + PUBLICATION_PROOF_TTL_SECONDS, verified.exp),
    requestHash: publicationReference(request),
    publicationId: publication.publicationId,
    publishedAt: publication.publishedAt,
    appUrl: publication.appUrl,
  };
  return sign(proof, options.appKey, "proof");
}
export function verifyPublicationProof(
  raw: string,
  options: PublicationOptions & { request: string },
): PublicationProof {
  const request = verifyPublicationRequest(options.request, options);
  const proof = read(raw, options, "proof") as PublicationProof;
  if (
    proof.nonce !== request.nonce ||
    proof.kind !== request.kind ||
    proof.requestHash !== publicationReference(options.request) ||
    proof.exp > request.exp ||
    proof.iat < request.iat ||
    proof.publishedAt < request.iat ||
    proof.publishedAt > request.exp
  )
    throw new PublicationProofError("wrong-context");
  return proof;
}
