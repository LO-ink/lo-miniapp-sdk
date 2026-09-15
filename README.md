# LO Mini App SDK

Platform-neutral TypeScript contract and imperative client for LO Mini Apps. It has no runtime dependencies, performs no host discovery, installs no globals, and is safe to import during server rendering.

```ts
import { createMiniAppClient, requestWriteAccess } from "@lo/miniapp-sdk";
import { createAdapter } from "@lo/adapter-lo";

const adapter = createAdapter();
if (adapter) {
  const client = createMiniAppClient(adapter);
  if (client.supports("requestWriteAccess")) {
    const allowed = await requestWriteAccess(client, { signal });
  }
  client.dispose();
}
```

An adapter supplies verified capabilities, normalized events, a snapshot, launch data, and typed operations. The client enforces capability checks, positive per-call timeouts, abort handling, one-shot settlement, request cleanup, listener cleanup, and deterministic disposal.

`adapter.snapshot().theme` uses semantic `ThemeColors` fields such as `background`, `text`, `action`, and `secondaryBackground`; host wire keys never enter application code. Calling `client.on` throws `MiniAppError("unsupported")` when an adapter cannot provide event subscription.

The portable operation set includes invoice presentation with a normalized `paid | cancelled | failed | pending` result. Hosts that cannot present invoices omit the `invoice` capability, so the client rejects before invoking the adapter.

Launch data is untrusted client input. Send it to an application backend that validates its signature, age, and audience. Never put server secrets in a Mini App.

`authenticate` uses session caching only when the application injects a `Storage` object. It never reads global session storage implicitly.

## Development

Requires Node 20 or newer.

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```
