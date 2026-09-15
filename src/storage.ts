import type { MiniAppClient, CallOptions } from "./client.js";

export function cloudStorage(client: MiniAppClient) {
  return {
    setItem: (key: string, value: string, options?: CallOptions) =>
      client.call("cloudStorageSet", { key, value }, options),
    getItem: (key: string, options?: CallOptions) =>
      client.call("cloudStorageGet", { key }, options),
    getItems: (keys: readonly string[], options?: CallOptions) =>
      client.call("cloudStorageGetMany", { keys }, options),
    removeItem: (key: string, options?: CallOptions) =>
      client.call("cloudStorageRemove", { key }, options),
    removeItems: (keys: readonly string[], options?: CallOptions) =>
      client.call("cloudStorageRemoveMany", { keys }, options),
    getKeys: (options?: CallOptions) =>
      client.call("cloudStorageKeys", undefined, options),
  };
}

export function deviceStorage(client: MiniAppClient) {
  return {
    setItem: (key: string, value: string, options?: CallOptions) =>
      client.call("deviceStorageSet", { key, value }, options),
    getItem: (key: string, options?: CallOptions) =>
      client.call("deviceStorageGet", { key }, options),
    removeItem: (key: string, options?: CallOptions) =>
      client.call("deviceStorageRemove", { key }, options),
    clear: (options?: CallOptions) =>
      client.call("deviceStorageClear", undefined, options),
  };
}

export function secureStorage(client: MiniAppClient) {
  return {
    setItem: (key: string, value: string, options?: CallOptions) =>
      client.call("secureStorageSet", { key, value }, options),
    getItem: (key: string, options?: CallOptions) =>
      client.call("secureStorageGet", { key }, options),
    restoreItem: (key: string, options?: CallOptions) =>
      client.call("secureStorageRestore", { key }, options),
    removeItem: (key: string, options?: CallOptions) =>
      client.call("secureStorageRemove", { key }, options),
    clear: (options?: CallOptions) =>
      client.call("secureStorageClear", undefined, options),
  };
}
