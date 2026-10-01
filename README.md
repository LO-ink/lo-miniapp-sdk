# LO Mini App SDK

The typed application API, protocol and lifecycle for LO Mini Apps. The SDK has
zero runtime dependencies, installs no globals and is safe to import during
server rendering. Host discovery and transport are supplied explicitly.

## Start with LO

```sh
npm install @lo-ink/miniapp-sdk @lo-ink/adapter-lo
```

```ts
import { createMiniAppClient } from "@lo-ink/miniapp-sdk";
import { createAdapter } from "@lo-ink/adapter-lo";

const adapter = createAdapter();
if (!adapter) throw new Error("Open this application inside LO");
const client = createMiniAppClient(adapter);

if (client.supports("ready")) await client.call("ready", undefined);
```

An adapter supplies capabilities, normalized events, a snapshot, opaque launch
data and typed operations. `@lo-ink/adapter-lo` 0.22 uses only the native LO port.
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
See [CHANGELOG.md](CHANGELOG.md) for the prepared release set.
