import type { MiniAppAdapter } from "./adapter.js";
import { MiniAppError, normalizeMiniAppError } from "./errors.js";
import { readRequestOptions } from "./request-options.js";
import type {
  Capability,
  MiniAppEvent,
  MiniAppEventMap,
  MiniAppOperation,
  OperationInput,
  OperationOutput,
} from "./protocol.js";

export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };
const MAX_TIMEOUT_MS = 2_147_483_647;

const operationCapability: Partial<Record<MiniAppOperation, Capability>> = {
  ready: "ready",
  expand: "expand",
  requestFullscreen: "fullscreen",
  exitFullscreen: "fullscreen",
  hideKeyboard: "hideKeyboard",
  setOrientationLock: "orientation",
  setButton: "mainButton",
  setClosingConfirmation: "closingConfirmation",
  setHeaderColor: "headerColor",
  setBackgroundColor: "backgroundColor",
  setBottomBarColor: "bottomBarColor",
  haptic: "haptics",
  showPopup: "popup",
  openLink: "openLink",
  sendData: "sendData",
  switchInlineQuery: "switchInlineQuery",
  readClipboard: "clipboard",
  getLocation: "location",
  openLocationSettings: "location",
  getBiometryInfo: "biometry",
  requestBiometryAccess: "biometry",
  authenticateBiometry: "biometry",
  updateBiometryToken: "biometry",
  openBiometrySettings: "biometry",
  startAccelerometer: "sensors",
  stopAccelerometer: "sensors",
  startGyroscope: "sensors",
  stopGyroscope: "sensors",
  startDeviceOrientation: "sensors",
  stopDeviceOrientation: "sensors",
  downloadFile: "downloadFile",
  openQrScanner: "qrScanner",
  closeQrScanner: "qrScanner",
  requestWriteAccess: "requestWriteAccess",
  requestContact: "requestContact",
  shareMessage: "shareMessage",
  shareToStory: "shareToStory",
  openInvoice: "invoice",
  cloudStorageSet: "cloudStorage",
  cloudStorageGet: "cloudStorage",
  cloudStorageGetMany: "cloudStorage",
  cloudStorageRemove: "cloudStorage",
  cloudStorageRemoveMany: "cloudStorage",
  cloudStorageKeys: "cloudStorage",
  deviceStorageSet: "deviceStorage",
  deviceStorageGet: "deviceStorage",
  deviceStorageRemove: "deviceStorage",
  deviceStorageClear: "deviceStorage",
  secureStorageSet: "secureStorage",
  secureStorageGet: "secureStorage",
  secureStorageRestore: "secureStorage",
  secureStorageRemove: "secureStorage",
  secureStorageClear: "secureStorage",
};

const defaultTimeout: Partial<Record<MiniAppOperation, number>> = {
  requestWriteAccess: 60_000,
  requestContact: 60_000,
  shareMessage: 300_000,
  openInvoice: 300_000,
  secureStorageSet: 60_000,
  secureStorageGet: 60_000,
  secureStorageRestore: 60_000,
  secureStorageRemove: 60_000,
  secureStorageClear: 60_000,
};

export interface MiniAppClient {
  readonly adapter: MiniAppAdapter;
  readonly disposed: boolean;
  supports(capability: Capability): boolean;
  on<K extends MiniAppEvent>(
    event: K,
    listener: (payload: MiniAppEventMap[K]) => void,
  ): () => void;
  call<K extends MiniAppOperation>(
    operation: K,
    input: OperationInput<K>,
    options?: CallOptions,
  ): Promise<OperationOutput<K>>;
  dispose(): void;
}

export function createMiniAppClient(adapter: MiniAppAdapter): MiniAppClient {
  let disposed = false;
  const subscriptions = new Set<() => void>();
  const pending = new Set<(reason: MiniAppError) => void>();

  const client: MiniAppClient = {
    adapter,
    get disposed() {
      return disposed;
    },
    supports(capability) {
      return !disposed && adapter.capabilities.has(capability);
    },
    on(event, listener) {
      if (disposed) return () => {};
      let active = true;
      const releaseAdapter = adapter.subscribe(event, listener);
      const release = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(release);
        releaseAdapter();
      };
      subscriptions.add(release);
      if (disposed) {
        try {
          release();
        } catch {
          /* Disposal remains best effort. */
        }
      }
      return release;
    },
    async call(operation, input, options = {}) {
      if (disposed) throw new MiniAppError("disposed");
      options = readRequestOptions(options);
      const capability =
        operation === "setButton"
          ? (`${(input as { button: string }).button}Button` as Capability)
          : operationCapability[operation];
      if (capability && !adapter.capabilities.has(capability)) {
        throw new MiniAppError("unsupported", `${operation} is not supported`);
      }
      const timeoutMs =
        options.timeoutMs ?? defaultTimeout[operation] ?? 30_000;
      if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > MAX_TIMEOUT_MS
      ) {
        throw new RangeError(
          `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
        );
      }
      if (options.signal?.aborted) throw new MiniAppError("aborted");

      return new Promise<OperationOutput<typeof operation>>(
        (resolve, reject) => {
          let settled = false;
          let cleanupAdapter: (() => void) | undefined;
          let cleanupRan = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const controller = new AbortController();
          type Outcome =
            | { ok: true; value: OperationOutput<typeof operation> }
            | { ok: false; error: unknown };
          const runCleanup = () => {
            if (cleanupRan || !cleanupAdapter) return;
            cleanupRan = true;
            try {
              cleanupAdapter();
            } catch {
              /* Cleanup must not change the result. */
            }
          };
          const finish = (outcome: Outcome) => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            try {
              options.signal?.removeEventListener("abort", abort);
            } catch {
              /* Preserve request settlement. */
            }
            pending.delete(disposeRequest);
            runCleanup();
            if (outcome.ok) resolve(outcome.value);
            else reject(normalizeMiniAppError(outcome.error));
          };
          const cancel = (reason: MiniAppError) => {
            if (!controller.signal.aborted) controller.abort(reason);
            finish({ ok: false, error: reason });
          };
          const abort = () => cancel(new MiniAppError("aborted"));
          const disposeRequest = (reason: MiniAppError) => cancel(reason);
          pending.add(disposeRequest);
          try {
            options.signal?.addEventListener("abort", abort, { once: true });
            if (settled) return;
            if (options.signal?.aborted) {
              abort();
              return;
            }
          } catch (error) {
            finish({ ok: false, error });
            return;
          }
          timer = setTimeout(
            () => cancel(new MiniAppError("timeout")),
            timeoutMs,
          );
          try {
            const request = adapter.execute(operation, input, {
              signal: controller.signal,
            });
            const promise = "promise" in request ? request.promise : request;
            cleanupAdapter = "promise" in request ? request.cleanup : undefined;
            if (settled) runCleanup();
            Promise.resolve(promise).then(
              (value) => finish({ ok: true, value }),
              (error) => finish({ ok: false, error }),
            );
          } catch (error) {
            finish({ ok: false, error });
          }
        },
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const release of [...subscriptions]) {
        try {
          release();
        } catch {
          /* Continue releasing remaining listeners. */
        }
      }
      const reason = new MiniAppError("disposed");
      for (const cancel of [...pending]) {
        try {
          cancel(reason);
        } catch {
          /* Continue cancelling remaining calls. */
        }
      }
    },
  };
  return client;
}

export function supports(
  target: MiniAppClient | MiniAppAdapter | null,
  capability: Capability,
): boolean {
  if (!target) return false;
  return "adapter" in target
    ? target.supports(capability)
    : target.capabilities.has(capability);
}

export function subscribe<K extends MiniAppEvent>(
  client: MiniAppClient | null,
  event: K,
  listener: (payload: MiniAppEventMap[K]) => void,
): () => void {
  return client?.on(event, listener) ?? (() => {});
}
