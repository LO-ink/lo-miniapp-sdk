import type { MiniAppAdapter } from "./adapter.js";

export interface AppSession {
  token: string;
  startParam: string;
}

/** Cache entries are hints. The server must validate launch data and cached sessions. */
export async function authenticate<T extends AppSession>(
  adapter: MiniAppAdapter,
  options: {
    storageKey: string;
    authenticate: (launch: {
      adapterId: string;
      launchData: string;
    }) => Promise<T>;
    validate: (token: string) => Promise<unknown>;
    isUnauthorized: (error: unknown) => boolean;
    storage?: Storage | null;
  },
): Promise<AppSession> {
  let fingerprint = "";
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(adapter.launchData),
    );
    fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  const storage = options.storage ?? null;
  let cached: unknown;
  try {
    cached = JSON.parse(storage?.getItem(options.storageKey) ?? "null");
  } catch {
    /* untrusted */
  }
  if (fingerprint && cached && typeof cached === "object") {
    const value = cached as Record<string, unknown>;
    if (
      value.fingerprint === fingerprint &&
      value.adapterId === adapter.id &&
      typeof value.token === "string" &&
      value.token &&
      typeof value.startParam === "string"
    ) {
      try {
        await options.validate(value.token);
        return { token: value.token, startParam: value.startParam };
      } catch (error) {
        if (!options.isUnauthorized(error)) throw error;
      }
    }
  }
  const session = await options.authenticate({
    adapterId: adapter.id,
    launchData: adapter.launchData,
  });
  if (
    typeof session.token !== "string" ||
    !session.token ||
    typeof session.startParam !== "string"
  ) {
    throw new TypeError("Invalid application session");
  }
  if (fingerprint) {
    try {
      storage?.setItem(
        options.storageKey,
        JSON.stringify({
          adapterId: adapter.id,
          fingerprint,
          token: session.token,
          startParam: session.startParam,
        }),
      );
    } catch {
      /* optional */
    }
  }
  return { token: session.token, startParam: session.startParam };
}
