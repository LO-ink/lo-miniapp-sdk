import { MiniAppError, normalizeMiniAppError } from "./errors.js";
import { readRequestOptions } from "./request-options.js";
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Adapts a callback API and ignores late callbacks after timeout or abort. */
export async function withHostCallback<T>(
  start: (finish: (error: unknown, value?: T) => void) => void | (() => void),
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  options = readRequestOptions(options);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    return Promise.reject(
      new RangeError(
        `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup: void | (() => void);
    let cleanupRan = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const runCleanup = () => {
      if (cleanupRan || !cleanup) return;
      cleanupRan = true;
      try {
        cleanup();
      } catch {
        /* Cleanup must not replace the request result. */
      }
    };
    const settleSuccess = (value: T) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        options.signal?.removeEventListener("abort", abort);
      } catch {
        /* Preserve request settlement. */
      }
      runCleanup();
      resolve(value);
    };
    const settleFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        options.signal?.removeEventListener("abort", abort);
      } catch {
        /* Preserve request settlement. */
      }
      runCleanup();
      reject(normalizeMiniAppError(error));
    };
    const finish = (error: unknown, value?: T) => {
      if (error == null) settleSuccess(value as T);
      else settleFailure(error);
    };
    const abort = () => settleFailure(new MiniAppError("aborted"));
    try {
      options.signal?.addEventListener("abort", abort, { once: true });
      if (settled) return;
      if (options.signal?.aborted) return abort();
    } catch (error) {
      settleFailure(error);
      return;
    }
    timer = setTimeout(
      () => settleFailure(new MiniAppError("timeout")),
      timeoutMs,
    );
    try {
      cleanup = start(finish);
      if (settled) runCleanup();
    } catch (error) {
      settleFailure(error);
    }
  });
}
