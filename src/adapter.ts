import type {
  Capability,
  HostSnapshot,
  MiniAppEvent,
  MiniAppEventMap,
  MiniAppOperation,
  OperationInput,
  OperationOutput,
  RequestContext,
} from "./protocol.js";

export type AdapterRequest<T> = {
  promise: PromiseLike<T>;
  /** Releases callback/event resources. Safe to call more than once. */
  cleanup?: () => void;
};

/** Platform boundary implemented by host-specific packages. */
export interface MiniAppAdapter {
  readonly id: string;
  readonly launchData: string;
  readonly capabilities: ReadonlySet<Capability>;
  snapshot(): HostSnapshot;
  subscribe<K extends MiniAppEvent>(
    event: K,
    listener: (payload: MiniAppEventMap[K]) => void,
  ): () => void;
  execute<K extends MiniAppOperation>(
    operation: K,
    input: OperationInput<K>,
    context: RequestContext,
  ): AdapterRequest<OperationOutput<K>> | PromiseLike<OperationOutput<K>>;
}
