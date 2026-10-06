import { createMiniAppClient, type MiniAppClient } from "./client.js";
import {
  createNativeAdapter,
  type LoNativeGlobal,
} from "./native-transport.js";

/** Creates a client for the native LO host, or null outside a supported host. */
export function createLoClient(scope?: LoNativeGlobal): MiniAppClient | null {
  const adapter = createNativeAdapter(scope);
  return adapter ? createMiniAppClient(adapter) : null;
}
