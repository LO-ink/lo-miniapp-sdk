import type { CallOptions, MiniAppClient } from "./client.js";
import type { StoryShareParams } from "./protocol.js";

export const requestWriteAccess = (
  client: MiniAppClient,
  options?: CallOptions,
) =>
  client.call("requestWriteAccess", undefined, {
    timeoutMs: 60_000,
    ...options,
  });
export const requestContact = (client: MiniAppClient, options?: CallOptions) =>
  client.call("requestContact", undefined, { timeoutMs: 60_000, ...options });

/** The request is signed by your backend; only that backend may trust the proof. */
export function requestContactsProof(
  client: MiniAppClient,
  input: { request: string },
  options?: CallOptions,
) {
  if (
    !input ||
    typeof input.request !== "string" ||
    !input.request.length ||
    input.request.length > 16_384 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.request)
  ) {
    return Promise.reject(new TypeError("Invalid contacts request"));
  }
  return client.call(
    "requestContactsProof",
    { request: input.request },
    { timeoutMs: 60_000, ...options },
  );
}
export function shareMessage(
  client: MiniAppClient,
  id: string,
  options?: CallOptions,
) {
  if (typeof id !== "string" || !id.length || id.length > 128) {
    return Promise.reject(new TypeError("Invalid prepared message ID"));
  }
  return client.call(
    "shareMessage",
    { id },
    { timeoutMs: 300_000, ...options },
  );
}

function validateStoryUrl(
  value: unknown,
  media: boolean,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > (media ? 8192 : 2048) ||
    !/^https?:\/\//i.test(value) ||
    // eslint-disable-next-line no-control-regex -- Reject control bytes in untrusted input.
    /[\s\\\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError("Invalid story URL");
  }
  const url = new URL(value);
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    (media && url.protocol !== "https:")
  ) {
    throw new TypeError("Invalid story URL");
  }
}

export async function shareToStory(
  client: MiniAppClient,
  mediaUrl: string,
  params?: StoryShareParams,
  options?: CallOptions,
) {
  validateStoryUrl(mediaUrl, true);
  if (
    params?.text !== undefined &&
    (typeof params.text !== "string" || params.text.length > 2048)
  ) {
    throw new TypeError("Invalid story caption");
  }
  if (params?.link) {
    validateStoryUrl(params.link.url, false);
    if (
      params.link.name !== undefined &&
      (typeof params.link.name !== "string" || params.link.name.length > 48)
    ) {
      throw new TypeError("Invalid story link label");
    }
  }
  return client.call("shareToStory", { mediaUrl, params }, options);
}

/** Controls the host's vertical dismissal gesture, not page scrolling. */
export function setVerticalSwipes(
  client: MiniAppClient,
  enabled: boolean,
  options?: CallOptions,
) {
  if (typeof enabled !== "boolean")
    return Promise.reject(new TypeError("enabled must be a boolean"));
  return client.call("setVerticalSwipes", { enabled }, options);
}
