export type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };

/** Snapshot caller-owned options before a request acquires timers or listeners. */
export function readRequestOptions(options: RequestOptions): RequestOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Request options must be an object");
  }
  const { signal, timeoutMs } = options;
  if (
    signal !== undefined &&
    (signal === null ||
      typeof signal !== "object" ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")
  ) {
    throw new TypeError("signal must be an AbortSignal");
  }
  return { signal, timeoutMs };
}
