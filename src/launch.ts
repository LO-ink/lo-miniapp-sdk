/** Display-only identity. Trust it only after server signature verification. */
export interface LaunchUser {
  readonly id: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly photoUrl?: string;
  readonly languageCode?: string;
}
export interface LaunchData {
  readonly user?: LaunchUser;
  readonly startParam?: string;
  readonly chatType?: string;
  readonly authDate?: number;
  readonly appId?: string;
  readonly queryId?: string;
}

/** Strict query decoding shared by the display parser and server verifier. */
export function decodeLaunchParams(raw: string): Map<string, string> {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 65536)
    throw new TypeError("Invalid launch data");
  const params = new Map<string, string>();
  if (!raw) return params;
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const equals = pair.indexOf("=");
    const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
    const name = decode(equals < 0 ? pair : pair.slice(0, equals));
    const value = decode(equals < 0 ? "" : pair.slice(equals + 1));
    if (!name) throw new TypeError("Invalid launch parameter");
    if (params.has(name)) throw new DuplicateLaunchParameter(name);
    params.set(name, value);
  }
  return params;
}
export class DuplicateLaunchParameter extends Error {
  constructor(readonly parameter: string) {
    super("Duplicate launch parameter");
  }
}

function launchUser(raw: string | undefined): LaunchUser | undefined {
  if (raw === undefined) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError("Invalid launch user");
  const user = parsed as Record<string, unknown>;
  // JSON.parse loses integer precision on older browsers. Read the top-level id
  // token from the original JSON, after validating the entire document above.
  const tokens =
    raw.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]:,]|true|false|null/g,
    ) ?? [];
  let depth = 0;
  let id: string | undefined;
  let found = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{" || token === "[") depth++;
    else if (token === "}" || token === "]") depth--;
    else if (
      depth === 1 &&
      token.startsWith('"') &&
      tokens[i + 1] === ":" &&
      JSON.parse(token) === "id"
    ) {
      if (found) throw new TypeError("Duplicate user identifier");
      found = true;
      const value = tokens[i + 2];
      id = value?.startsWith('"') ? JSON.parse(value) : value;
    }
  }
  if (typeof id !== "string" || !/^[1-9][0-9]*$/.test(id))
    throw new TypeError("Invalid launch user identifier");
  let photoUrl: string | undefined;
  if (typeof user.photo_url === "string") {
    try {
      const url = new URL(user.photo_url);
      if (
        user.photo_url.trim() === user.photo_url &&
        url.protocol === "https:" &&
        url.hostname.endsWith(".lo.ink") &&
        !url.username &&
        !url.password &&
        !url.port &&
        // eslint-disable-next-line no-control-regex -- Reject control bytes in untrusted input.
        !/[\u0000\r\n\t]/.test(user.photo_url)
      )
        photoUrl = user.photo_url;
    } catch {
      /* An untrusted avatar is omitted. */
    }
  }
  const optional = (key: string) =>
    typeof user[key] === "string" ? (user[key] as string) : undefined;
  return {
    id,
    firstName: optional("first_name"),
    lastName: optional("last_name"),
    username: optional("username"),
    photoUrl,
    languageCode: optional("language_code"),
  };
}
export function launchDataFromParams(
  params: ReadonlyMap<string, string>,
): LaunchData {
  const date = params.get("auth_date");
  const authDate =
    date !== undefined &&
    /^[0-9]+$/.test(date) &&
    Number.isSafeInteger(Number(date))
      ? Number(date)
      : undefined;
  return {
    user: launchUser(params.get("user")),
    authDate,
    appId: params.get("app_id"),
    startParam: params.get("start_param"),
    chatType: params.get("chat_type"),
    queryId: params.get("query_id"),
  };
}
/** Unverified host data for rendering; never an authentication credential. */
export function parseLaunchDataUnsafe(raw: string): LaunchData {
  try {
    return launchDataFromParams(decodeLaunchParams(raw));
  } catch {
    return {};
  }
}
