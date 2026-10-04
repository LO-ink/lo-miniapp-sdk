# Changelog

## 0.20.1

- Sum system and application safe-area insets consistently in both CSS helpers.
- Preserve CSS fallbacks when the application supplies no inset values.
- Stop late appearance callbacks and release every listener even if cleanup fails.
- Align Go and Node avatar validation for whitespace, HTTPS casing and port 443.

## 0.20.0

- Added isolated Node /server initData verifier and public stdlib Go module with shared adversarial vectors.
- Added launchUnsafe display parsing with exact string IDs and constrained avatar URLs.
- Added safe-area CSS binding and typed NoBot support for updated native hosts.

## 0.19.2 — prepared release

- Preserve the original abort/timeout outcome when transport cancellation
  synchronously disposes the client.
- Notify transport cancellation before cleanup detaches its abort listener.
- Bind appearance from snapshots and available events on partial hosts; real
  subscription failures still propagate and release acquired resources.
- Stop retained event callbacks after unsubscribe or client disposal.
- Reject invalid adapters at construction and unknown JavaScript operations
  before host resources are acquired.
- Make the operation-to-capability map exhaustive at compile time.
- Add typed vertical dismissal controls, negotiated through the own native port.
- Story presentation uses a 60-second preparation deadline and the native link-length bound.
- Enforce source and distribution boundaries with architecture tests.

The native integration is `@lo-ink/adapter-lo` 0.22. Older host compatibility
moves to a separate opt-in integration. This SDK patch preserves typed public
operations. Package preparation does not mean registry publication or host
rollout has occurred.
