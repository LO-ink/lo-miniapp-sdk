import { createHmac, timingSafeEqual } from "node:crypto";
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
