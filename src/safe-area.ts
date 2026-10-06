import { MiniAppError } from "./errors.js";
import type { MiniAppClient } from "./client.js";
import type { HostSnapshot, Insets } from "./protocol.js";

type CssValue = { value: string; priority: string };
type Binding = { order: bigint; value: string };
type PropertyOwners = {
  original: CssValue;
  written: CssValue;
  bindings: Map<object, Binding>;
};
const styleOwners = new WeakMap<
  CSSStyleDeclaration,
  Map<string, PropertyOwners>
>();
let bindingSequence = 0n;

function cssOwner(style: CSSStyleDeclaration) {
  const owner = {};
  const order = ++bindingSequence;
  const names = new Set<string>();
  const read = (name: string): CssValue => ({
    value: style.getPropertyValue(name),
    priority: style.getPropertyPriority(name),
  });
  const matches = (name: string, expected: CssValue) => {
    const actual = read(name);
    return (
      actual.value === expected.value && actual.priority === expected.priority
    );
  };
  const newest = (state: PropertyOwners) => {
    let latest: Binding | undefined;
    for (const binding of state.bindings.values())
      if (!latest || binding.order > latest.order) latest = binding;
    return latest;
  };
  const apply = (name: string, state: PropertyOwners, value: CssValue) => {
    const previous = state.written;
    const empty = { value: "", priority: "" };
    let clearing = false;
    try {
      // WebKit retains important custom properties on a normal setProperty.
      // Clear only this owned priority transition before applying host insets.
      if (previous.priority === "important" && value.value && !value.priority) {
        clearing = true;
        state.written = empty;
        style.removeProperty(name);
        if (!matches(name, empty)) return;
      }
      state.written = value;
      if (value.value) style.setProperty(name, value.value, value.priority);
      else style.removeProperty(name);
    } catch (error) {
      if (matches(name, previous)) state.written = previous;
      else if (clearing && matches(name, empty)) {
        // Roll back only our empty slot, never a value written by another caller.
        state.written = empty;
        try {
          style.setProperty(name, previous.value, previous.priority);
          if (matches(name, previous)) state.written = previous;
        } catch {
          /* Setup cleanup can still restore an unchanged empty slot. */
        }
      }
      throw error;
    }
  };
  return {
    write(name: string, value: string) {
      let properties = styleOwners.get(style);
      if (!properties) {
        properties = new Map();
        styleOwners.set(style, properties);
      }
      let state = properties.get(name);
      // An external writer ends the old ownership chain. A later host update
      // may acquire it again, but must then restore that external value.
      if (!state || !matches(name, state.written)) {
        const original = read(name);
        state = { original, written: original, bindings: new Map() };
        properties.set(name, state);
      }
      names.add(name);
      state.bindings.set(owner, { order, value });
      const latest = newest(state)!;
      if (latest.order === order) apply(name, state, { value, priority: "" });
    },
    release() {
      const properties = styleOwners.get(style);
      if (!properties) return;
      for (const name of names) {
        const state = properties.get(name);
        if (!state?.bindings.has(owner)) continue;
        const wasNewest = newest(state)?.order === order;
        state.bindings.delete(owner);
        if (!matches(name, state.written)) {
          properties.delete(name);
          continue;
        }
        if (wasNewest) {
          const next = newest(state);
          try {
            apply(
              name,
              state,
              next ? { value: next.value, priority: "" } : state.original,
            );
          } catch {
            // A detached or broken style must not prevent other owners releasing.
            properties.delete(name);
          }
        }
        if (state.bindings.size === 0) properties.delete(name);
      }
      names.clear();
      if (properties.size === 0) styleOwners.delete(style);
    },
  };
}

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
  const owner = cssOwner(style);
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
      owner.write(name, `${safe + content}px`);
    }
  };
  const snapshot = (value: HostSnapshot) => {
    if (value.safeArea !== undefined) safeArea = value.safeArea;
    if (value.contentSafeArea !== undefined)
      contentSafeArea = value.contentSafeArea;
    write();
  };
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
    snapshot(client.adapter.snapshot());
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
    owner.release();
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
    owner.release();
  };
}
