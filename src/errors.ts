export type MiniAppErrorCode =
  | "unsupported"
  | "timeout"
  | "aborted"
  | "disposed"
  | "failed"
  | "invalid-response";

export class MiniAppError extends Error {
  constructor(
    public readonly code: MiniAppErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MiniAppError";
  }
}

export function normalizeMiniAppError(error: unknown): MiniAppError {
  if (error instanceof MiniAppError) return error;
  if (error instanceof Error) {
    return new MiniAppError("failed", error.message || "Host request failed", {
      cause: error,
    });
  }
  return new MiniAppError("failed", "Host request failed", { cause: error });
}
