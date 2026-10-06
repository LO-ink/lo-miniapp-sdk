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

Version 0.22 moves native transport into this package. `@lo-ink/adapter-lo` 0.24 is
an optional re-export for existing imports. When upgrading `bindAppearance`,
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

## Development and distribution

Requires Node 20 or newer. Both ESM and CommonJS entrypoints include declarations;
NodeNext, Node16 and bundler consumers are tested using a packed artifact.

```sh
npm ci
npm run check
npm test
npm run format:check
npm pack --dry-run
```

CI exercises Node 20, 22 and 24. Architecture checks cover nested source,
built JavaScript and declarations, and reject host or compatibility dependencies.
See [CHANGELOG.md](CHANGELOG.md) for release changes.

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
exists for deterministic tests. [Go module](go/README.md) shares all test vectors.

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
