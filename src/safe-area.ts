import { MiniAppError } from "./errors.js";
import type { MiniAppClient } from "./client.js";
import type { HostSnapshot, Insets } from "./protocol.js";

/** Sum host cutout and header insets; missing data preserves CSS env() fallbacks. */
export function bindSafeAreaCss(
  client: MiniAppClient,
  options: { prefix?: string } = {},
): () => void {
  const prefix = options.prefix ?? "--lo-safe";
  if (!/^--[a-zA-Z0-9_-]+$/.test(prefix))
    throw new TypeError("Expected a CSS custom-property prefix");
  if (typeof document === "undefined" || client.disposed) return () => {};
  const style = document.documentElement.style;
  const previous = new Map<string, { value: string; priority: string }>();
  const written = new Map<string, string>();
  let safeArea: Insets | undefined;
  let contentSafeArea: Insets | undefined;
  let active = true;
  const write = () => {
    if (!active || (!safeArea && !contentSafeArea)) return;
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const safe = safeArea?.[edge] ?? 0;
      const content = contentSafeArea?.[edge] ?? 0;
      if (
        !Number.isFinite(safe) ||
        safe < 0 ||
        !Number.isFinite(content) ||
        content < 0 ||
        !Number.isFinite(safe + content)
      )
        continue;
      const name = `${prefix}-${edge}`;
      if (!previous.has(name))
        previous.set(name, {
          value: style.getPropertyValue(name),
          priority: style.getPropertyPriority(name),
        });
      const value = `${safe + content}px`;
      style.setProperty(name, value);
      written.set(name, value);
    }
  };
  const snapshot = (value: HostSnapshot) => {
    if (value.safeArea !== undefined) safeArea = value.safeArea;
    if (value.contentSafeArea !== undefined)
      contentSafeArea = value.contentSafeArea;
    write();
  };
  snapshot(client.adapter.snapshot());
  const releases: Array<() => void> = [];
  const subscribe = <
    K extends "safeAreaChanged" | "contentSafeAreaChanged" | "viewportChanged",
  >(
    event: K,
    listener: Parameters<MiniAppClient["on"]>[1],
  ) => {
    try {
      releases.push(client.on(event, listener));
    } catch (error) {
      if (!(error instanceof MiniAppError) || error.code !== "unsupported")
        throw error;
    }
  };
  try {
    subscribe("safeAreaChanged", (value) => {
      safeArea = value as Insets;
      write();
    });
    subscribe("contentSafeAreaChanged", (value) => {
      contentSafeArea = value as Insets;
      write();
    });
    subscribe("viewportChanged", (value) => snapshot(value as HostSnapshot));
  } catch (error) {
    active = false;
    for (const release of releases) {
      try {
        release();
      } catch {
        /* Continue releasing the other subscriptions. */
      }
    }
    for (const [name, old] of previous) {
      if (
        style.getPropertyValue(name) !== written.get(name) ||
        style.getPropertyPriority(name) !== ""
      )
        continue;
      if (old.value) style.setProperty(name, old.value, old.priority);
      else style.removeProperty(name);
    }
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    for (const release of releases) {
      try {
        release();
      } catch {
        /* Cleanup must still restore owned CSS properties. */
      }
    }
    for (const [name, old] of previous) {
      if (
        style.getPropertyValue(name) !== written.get(name) ||
        style.getPropertyPriority(name) !== ""
      )
        continue;
      if (old.value) style.setProperty(name, old.value, old.priority);
      else style.removeProperty(name);
    }
  };
}
