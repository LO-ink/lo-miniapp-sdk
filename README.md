# LO Mini App SDK

The typed application API, protocol and lifecycle for LO Mini Apps. The SDK has
zero runtime dependencies, installs no globals and is safe to import during
server rendering. Native LO discovery and transport are included. Other hosts use explicit adapters.

## Start with LO

```sh
npm install @lo-ink/miniapp-sdk
```

```ts
import { createLoClient } from "@lo-ink/miniapp-sdk";

const client = createLoClient();
if (!client) throw new Error("Open this application inside LO");

if (client.supports("ready")) await client.call("ready", undefined);
```

An adapter supplies capabilities, normalized events, a snapshot, opaque launch
data and typed operations. `createLoClient` discovers only `LO.MiniAppNative`.
It never loads scripts or retries requests through another host.
`createMiniAppClient(adapter)` remains available for explicit integrations.
Older host support is an explicit, separately installed migration integration.
Keep that choice in the application's composition root.

The examples assume the owner retains `client` for its lifetime. Release it
when that owner unmounts or the application is torn down:

```ts
const unsubscribe = client.on("themeChanged", (snapshot) => {
  renderTheme(snapshot.theme);
});

// At teardown:
unsubscribe();
client.dispose();
```

Event availability is supplied by the host. If an event cannot be subscribed to,
`client.on` throws `MiniAppError` with code `unsupported`. Unsubscribe functions
are idempotent; released listeners do not receive retained callbacks.

`bindAppearance` starts from the host snapshot and system preference, then binds
only available appearance events. Missing optional events do not stop startup;
other subscription failures still propagate after acquired listeners are released.
It writes `data-lo-theme`, the same theme selector used by `@lo-ink/ui`, and reads
`--lo-color-canvas` for host chrome. Supply `backgroundVariable` for a custom
palette. Explicit `data-preference="light"` or `"dark"` overrides host/system
appearance; scoped UI galleries may set their own `data-lo-theme`.

## Native transport ownership

The SDK owns the native port decoder, request bounds, cancellation and event
state. `createLoClient` and `createNativeAdapter` share one connection and a
32-request budget per port within one SDK module. Importing the SDK does not
inspect globals or open a connection. Request IDs include a cryptographically
random module namespace, preventing independently loaded SDK copies (including
ESM and CommonJS) from settling each other's requests. Native requests require
Web Crypto. Independent historical copies retain their own concurrency budgets;
applications should resolve one SDK version.

Native requests have a 60-second host cap. Caller timeouts may shorten this cap,
but cannot extend it. Launch data remains untrusted until verified by a server.

The native transport is included in this package. When upgrading `bindAppearance`,
replace application selectors for `data-theme` with `data-lo-theme`; the default
background variable is now `--lo-color-canvas`.

## Permissions and requests

```ts
import { requestWriteAccess } from "@lo-ink/miniapp-sdk";

const controller = new AbortController();
if (client.supports("requestWriteAccess")) {
  const allowed = await requestWriteAccess(client, {
    signal: controller.signal,
  });
  // false means the user declined; it is not a transport error.
  renderPermission(allowed);
}
```

Every request has a positive, bounded deadline and accepts an `AbortSignal`.
The client settles once, releases callback resources and aborts the transport
on cancellation, timeout or disposal. Late responses cannot change its result.
Cancellation cannot undo a native action that already completed. Writes are
never retried automatically.

| Error code         | Meaning                                          |
| ------------------ | ------------------------------------------------ |
| `unsupported`      | Unknown operation or unavailable host capability |
| `timeout`          | The request deadline elapsed                     |
| `aborted`          | The caller cancelled the request                 |
| `disposed`         | The client owner released the client             |
| `invalid-response` | The adapter rejected an invalid host result      |
| `failed`           | The host or transport failed                     |
| `no-bot`           | Native host reports no bot linked to the app     |

Invalid adapter contracts, button identifiers and request option shapes fail
with `TypeError`. Invalid deadlines fail with `RangeError`. Capabilities describe
availability, not backend authorization. Render controls from `supports(...)`
and handle failures even for supported operations.

## Contract

The public `@lo-ink/miniapp-sdk/protocol` entrypoint owns protocol version,
capabilities, events, operation inputs and results. It is independent of host
version strings and internal server RPC schemas.

- Appearance uses semantic color roles (`background`, `text`, `action`) and
  normalized viewport and safe-area values.
- Buttons, fullscreen, orientation, haptics and popups use typed operations.
- `setVerticalSwipes` controls host dismissal without disabling page scrolling.
- Story sharing presents the native editor; only the user can publish a story.
- Permissions, location, biometry, sensors, QR and clipboard remain host-owned.
- Sharing, links, file downloads and storage require their own capabilities.
- Invoice results are `paid | cancelled | failed | pending`; declaring an
  operation in the contract does not imply that a particular host ships it.

The optional helpers for appearance, permissions, sharing and storage use this
same client contract. No framework or browser storage is required to import it.

## Authentication

Launch data is untrusted client input. Send its exact bytes to your application
backend, which validates the signature, age and audience before issuing an
application session. Never place server secrets in a Mini App. Host discovery
and client capability checks do not authenticate the user.

`authenticate` only caches when the application injects a `Storage` object.
Cached tokens are validated by the application backend; no global session
storage is read implicitly. Keep identities scoped to their issuing provider.

## Game integration guide

See [Building games for LO Mini Apps](docs/games.md) for lifecycle and native
exit behavior, explicit pause/resume, audio and input suspension, mobile safe
areas, portable SDK integration and release verification. An installable
[agent skill](skills/lo-miniapp-game/SKILL.md) covers the same integration checks.
These are repository resources, not additional runtime APIs.

## Development and distribution

Requires Node.js 22.13 or newer for both the published package and repository
tooling. Use an up-to-date supported Node.js release. Version 0.23 drops Node.js
20 support; browser output, native host requirements and protocol behavior are
unchanged. Both ESM and CommonJS entrypoints include declarations;
NodeNext, Node16 and bundler consumers are tested using a packed artifact.

```sh
npm ci
npm run check
npm test
npm run format:check
npm pack --dry-run
```

CI exercises the exact minimum Node.js 22.13.0 and current Node.js 22 and 24
releases. Architecture checks cover nested source,
built JavaScript and declarations, and reject host or compatibility dependencies.
See [package history](https://github.com/LO-ink/lo-miniapp-sdk/commits/main/) for merged changes.

## Registered launch data

```ts
// Browser: display only. Never authenticate or choose a bot recipient with this.
const launch = client.launchUnsafe();
console.log(launch.user?.firstName);
```

IDs remain decimal strings, including 64-bit IDs. `photoUrl` is omitted unless it
uses HTTPS on a subdomain of `lo.ink`. `languageCode` may be empty or `en` even when
LO's interface is Russian: send the user's chosen notification language to your
server separately.

```ts
// Node server only. This entrypoint is never imported by the browser entrypoint.
import { verifyInitData, InitDataError } from "@lo-ink/miniapp-sdk/server";
const verified = verifyInitData(raw, { appKey, appId, maxAgeSec: 3600 });
const chatId = verified.user?.id;
```

**Verified `user.id` is the bot's `chat_id`.** Verification uses `node:crypto`, the
LO Connect app key as supplied (without base64 decoding), constant-time comparison,
an expected app ID, expiry and a five-minute future allowance. `InitDataError.code`
is `invalid-data`, `invalid-signature`, `wrong-app-id`, `expired`, `future-auth-date`
or `duplicate-parameter`. Keep secrets on the server. The optional `nowSec` clock
exists for deterministic tests. [Go module](https://github.com/LO-ink/lo-miniapp-sdk/blob/main/go/README.md) shares all test vectors.

## Safe area CSS

```ts
import { bindSafeAreaCss } from "@lo-ink/miniapp-sdk";
const unbind = bindSafeAreaCss(client); // optional { prefix: "--game-safe" }
// On unmount, before disposing the client:
unbind();
```

Use `padding-top: var(--lo-safe-top, env(safe-area-inset-top, 0px))`, and likewise
for right, bottom and left. The helper sums `safeArea` and `contentSafeArea`, handles
all three inset/viewport events and restores prior properties on unbind. No host
data means no CSS writes, preserving `env()` fallbacks; SSR is supported.
Overlapping bindings share ownership per style property: the newest live binding
controls it, and earlier bindings keep their latest insets for when that binding
ends. The last release restores the original value and priority. External CSS
edits are preserved on release; a later host update may acquire the property
again using that external value as its new baseline.

## Consent and missing bots

Native LO hosts implementing `NO_BOT` reject `requestWriteAccess` with `NoBot`
(`code: "no-bot"`). Keep a response locally until your server acknowledges it,
and retry delivery instead of prompting again. Older LO hosts return `false` for
both a missing bot and a user's denial: the SDK preserves that boolean and cannot
distinguish the cases. Confirm the bot link in LO Connect before asking. This SDK
release adds decoding support; it does not establish that the host change shipped.

## Quality checks

Run `make install` and `make ci` with Node.js 22.13 or newer. The same targets run
in GitHub Actions. CI checks formatting, ESLint (including typed promises),
TypeScript, dependency cycles and package boundaries, tests, published package
contents, vulnerable dependencies and secrets. English documentation and comments
are enforced; unfinished development notes and retired repository URLs fail CI.

Coverage includes unimported production files and fails below 90% lines and
statements, 90% functions, or 85% branches. Reports are uploaded as CI artifacts.

`make go-ci` checks Go formatting, vet, staticcheck, race tests, at least 90%
statement coverage, and govulncheck using the pinned Go toolchain.

Pass `onError` to `bindAppearance` to handle rejected host color updates. Without
a handler, errors are raised asynchronously. A rejection never switches transport.

Repository policy checks require Python 3 for Python comment tokenization. YAML
comments are parsed as YAML; embedded scripts and localized scalar values retain
their own language. LO credentials are checked by the root Gitleaks configuration
and a synthetic scanner regression before each repository scan.

### LO interface language

`client.adapter.snapshot().locale` is the selected interface language supplied by supporting native LO hosts, as a bounded language tag such as `en` or `pt-BR`. This optional launch/environment value is independent of `client.launchUnsafe().user?.languageCode`, which comes from signed launch data. Existing hosts may omit `locale`; do not substitute browser language and label it as LO language.

### Mutual contacts without a private service connection

New LO hosts may advertise `requestContactsProof`. This is distinct from
`requestContact`, which shares the current person's own contact. Older hosts
remain unsupported; denial rejects with `MiniAppError.code === "denied"`.
Never interpret either state as an empty contacts list.

1. Your authenticated backend selects **only participants of your application**.
   Use `contactsBatches(ids)` from `@lo-ink/miniapp-sdk/server` to deduplicate and
   split candidates into batches of at most 200. Empty input needs no host call.
2. Create each opaque token with `createContactsRequest({appKey, appId, userId,
candidateIds})`. Keep the exact request in a short-lived, server-owned batch
   snapshot. `userId` must come from verified launch data. Never send `appKey`
   to the web page.
3. The web page calls `requestContactsProof(client, {request})`. LO asks for
   consent, binds the operation to the active registered-app session and returns
   `{proof}`. The LO backend independently intersects candidates with its own
   authenticated launch membership for that App ID before consulting contacts.
   This includes authorized preview launches without counting them as analytics
   visits. Only mutual-contact matches in that intersection are disclosed: no
   full contact list, phone numbers, names or nonparticipant profiles.
4. Your backend calls `verifyContactsProof(proof, {appKey, appId, userId,
request})` for each expected batch. Publish a complete contacts ranking only
   after all batches of that snapshot have been verified. An omitted batch is
   incomplete, not an empty result. Expired requests require a new snapshot.
   Never accept a client-supplied list of IDs or trust a decoded unsigned proof.

The Go module exposes equivalent `contacts.Batches`, `contacts.CreateRequest`,
`contacts.VerifyRequest` and `contacts.VerifyProof`. The trusted LO issuer uses
`contacts.SignProof` after authenticated session validation, consent, platform-owned
participant filtering and the mutual-contact lookup. `SignProof` validates the
wire and subset, but cannot enforce membership itself. A proof
is not a notification permission: sending messages still requires the recipient's
write-access grant. Do not persist a social graph or reuse a proof for another
user, app or game operation.

#### Contacts wire version 1

Tokens are `base64url(UTF8(JSON)).base64url(signature)`, without padding. JSON
member ordering does not affect verification: authenticate the exact first token
segment, never reserialize it before checking the signature. Unknown or duplicate
members, malformed UTF-8 and noncanonical base64url are rejected. The decoded
payload has the following exact members:

- Request: `{v:1, app_id, user_id, iat, exp, nonce, candidate_ids}`.
- Proof: `{v:1, app_id, user_id, iat, exp, nonce, request_hash, ids}`.

`derivedKey = HMAC-SHA256(key=UTF8(appKey), data=UTF8(domain))`.
`signature = HMAC-SHA256(key=derivedKey, data=ASCII(firstTokenSegment))`.
The exact domains are `LOContactsRequest/v1` and `LOContactsProof/v1` respectively.
`request_hash` is lowercase hexadecimal SHA-256 of the complete ASCII request token.
`app_id` is the lowercase registered-app UUID. User and candidate IDs are canonical
positive signed-int64 decimal **strings**. The nonce is 16 random bytes encoded as
22 base64url characters. Candidates contain 1–200 distinct IDs; proof IDs may be
empty but must be unique and a subset of candidates. Each token is at most 16,384
ASCII bytes, within the host's 65,536-byte envelope limit.

Times are integer Unix seconds: `exp > now`, `0 < exp - iat <= 120` and
`iat <= now + 30`. The proof copies the app, user and nonce; it has
`proof.exp <= request.exp` and `proof.iat >= request.iat - 30`. Both tokens are
verified against the authenticated expected app/user and exact original request.
The signer caps proof expiry at `min(request.exp, now + 120)`.
`go/contacts/testdata/proof.json` contains the shared Node/Go interoperability
fixture using a deliberately fictitious app key.

HMAC matches the existing registered-app trust boundary: LO and that application's
backend know its app key. It is not third-party public attestation, and app-key
rotation invalidates outstanding requests and proofs. Platform-side rate limits,
consent, app-session binding and platform-owned participant filtering remain
mandatory even when a signature is valid. A developer knows its own app key and
can sign arbitrary candidate IDs: HMAC alone does not prove app membership.
Missing audience storage or a failed membership lookup must fail closed; an
empty verified audience returns a signed empty proof without reading the graph.

### Target screen orientation

SDK 0.25 adds the separate `screenOrientation` capability. An updated native
host must advertise both this capability and the `setScreenOrientation`
operation; SDK installation alone does not upgrade an installed LO client.

```ts
if (client.supports("screenOrientation")) {
  const applied = await client.call("setScreenOrientation", {
    mode: "portrait",
  });
  // The host accepted the native orientation policy.
  // Still gate portrait-only interaction on the actual viewport.
  console.log(applied.mode); // "portrait"
} else {
  // Explain that portrait locking requires an updated LO client.
}
```

Only `{ mode: "portrait" }` and `{ mode: "auto" }` are accepted. `auto` releases
this mini-app's orientation restriction; it does not override device policy or
another native screen's ownership. The host restores the previous owner on
mini-app teardown. A successful result confirms the native **policy**, not the
physical screen orientation or a completed rotation. The operating system may
apply rotation asynchronously or keep the current geometry under its own
restrictions. Keep checking viewport dimensions and pause portrait-only
interaction while the viewport is landscape, including after a successful call.

Native errors reported by the host reject the call; the SDK cannot independently
verify the physical device pose. Cancellation and timeouts use the usual `signal`
and `timeoutMs` call options. A returned policy that differs from the request,
or a malformed result, rejects with `invalid-response`.

`setOrientationLock({ locked: true })` remains unchanged: it locks the **current**
orientation and cannot promise portrait when launched in landscape. Older hosts
with only `orientation` reject the new operation as `unsupported`; do not fall
back to locking the current orientation and claim portrait support.

### Publication drafts and verified receipts

SDK 0.26 adds `publicationSharing`. The capability requires both
`composePublication` and `getPublicationProof` on an updated registered LO host.
An older host remains unsupported. Installing the SDK does not update the native
client or deploy the platform publication services.

1. An authenticated application backend creates a request with
   `createPublicationRequest({appId, appKey, userId, nonce, kind})` from
   `@lo-ink/miniapp-sdk/server`. Use the verified launch user, a fresh 16-byte
   base64url nonce, and kind `post` or `moment`. Persist the exact request and its
   application-specific operation. Keep the app key on the backend.
2. The page calls `composePublication(client, {request, text, mediaUrl,
suggestContacts})`. Text is optional, up to 2,200 characters; the optional
   media URL must be public HTTPS without credentials, up to 2,048 characters.
   A moment requires suitable media. The host verifies the challenge, supplies
   the registered app link and opens an editable native draft. The person reviews
   the draft and chooses whether to publish. `{status:"opened"}` acknowledges
   editor handoff only: it is **not** publication confirmation or a reward claim.
3. Optional invite suggestions stay inside LO. The host may offer mutual contacts
   who have not launched this app, with currently online candidates first. The
   page receives no contact IDs, presence, graph or selection. Suggestions do not
   publish, message or guarantee a notification to anyone.
4. After returning to the app, call `getPublicationProof(client, {request})`.
   `{status:"pending"}` means no qualifying publication is available yet. A
   verified response contains `{status:"verified", proof}`. The platform checks
   the authoritative publication owner, immutable request reference, publication
   time, published state and canonical app link. Upload completion and editor
   opening cannot produce a receipt. Deleted or taken-down objects do not qualify;
   natural moment visibility expiry alone does not prevent recovery.
5. The application backend calls `verifyPublicationProof(proof, {appId, appKey,
userId, request})`. Any reward must be transactional and idempotent using the
   actual `(kind, publicationId)` and the application's reward policy. Never
   trust client-supplied publication IDs, timestamps or an editor-success flag.

Requests default to a seven-day lifetime, configurable up to seven days, so a
persisted native upload and a later app session can recover the result. Proofs
last at most five minutes and never outlive the request. Recovery still requires
an authenticated registered-app session and an unexpired original challenge.
Avoid aggressive polling; preserve the server-owned request and allow an explicit
retry. Cancel, unsupported, permission and network errors remain typed host errors;
they are not equivalent to a verified publication.

The Go `publication` package provides `CreateRequest`, `VerifyRequest`,
`Reference`, `SignProof` and `VerifyProof`. The trusted issuer must obtain
`Published` from the authoritative owner service before `SignProof`; the helper
cannot check an object database. App keys are shared with LO, so receipts are
app-scoped HMAC attestations, not third-party public signatures. Key rotation
invalidates outstanding requests and receipts.

#### Publication wire version 1

Tokens use canonical unpadded base64url JSON and HMAC as described for contacts,
with separate domains `LOPublicationRequest/v1` and `LOPublicationProof/v1`.
Authenticate the exact encoded payload, not reserialized JSON. Unknown or
repeated keys, malformed UTF-8, noncanonical encodings and tokens over 4,096 bytes
are rejected. Exact payload members use camelCase:

- Request: `{v:1, appId, userId, nonce, kind, iat, exp}`.
- Proof: request members plus `{requestHash, publicationId, publishedAt, appUrl}`.

The reference and `requestHash` are lowercase SHA-256 hex of UTF-8
`"LOPublicationReference/v1\n" + request`, including the complete signed request.
The nonce is 16 random bytes; IDs are positive signed-int64 decimal strings and
appId is the lowercase registered UUID. Times are integer Unix seconds. A proof
has its own issuance/expiry, retains the request's nonce and kind, and identifies
an object published between request issuance and expiry, no later than proof
issuance. `appUrl` is exactly `https://lo.ink/app/{appId}`.
`go/publication/testdata/proof.json` is the shared synthetic Node/Go fixture.
