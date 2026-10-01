# Changelog

## 0.19.2 — prepared release

- Preserve the original abort/timeout outcome when transport cancellation
  synchronously disposes the client.
- Stop retained event callbacks after unsubscribe or client disposal.
- Reject invalid adapters at construction and unknown JavaScript operations
  before host resources are acquired.
- Make the operation-to-capability map exhaustive at compile time.
- Enforce source and distribution boundaries with architecture tests.

The native integration is `@lo-ink/adapter-lo` 0.22. Older host compatibility
moves to a separate opt-in integration. This SDK patch preserves typed public
operations. Package preparation does not mean registry publication or host
rollout has occurred.
