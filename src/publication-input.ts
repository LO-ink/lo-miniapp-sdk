/** Structural validation only. The registered host verifies the signed request. */
export function validatePublicationInput(
  operation: "composePublication" | "getPublicationProof",
  input: unknown,
): void {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid publication request");
  const value = input as Record<string, unknown>;
  const allowed =
    operation === "composePublication"
      ? ["request", "text", "mediaUrl", "suggestContacts"]
      : ["request"];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    typeof value.request !== "string" ||
    value.request.length > 4096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.request) ||
    (value.text !== undefined &&
      (typeof value.text !== "string" || value.text.length > 2200)) ||
    (value.suggestContacts !== undefined &&
      typeof value.suggestContacts !== "boolean")
  )
    throw new TypeError("Invalid publication request");
  if (value.mediaUrl !== undefined) {
    if (typeof value.mediaUrl !== "string" || value.mediaUrl.length > 2048)
      throw new TypeError("Invalid publication media URL");
    let url: URL;
    try {
      url = new URL(value.mediaUrl);
    } catch {
      throw new TypeError("Invalid publication media URL");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new TypeError("Invalid publication media URL");
  }
}
