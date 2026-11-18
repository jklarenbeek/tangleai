/**
 * Jaren's port transport, loaded only when a framed module connects. A desktop
 * whose modules all run in the page (shipped mounts, the built-in contracts)
 * never fetches `@jarenjs/contract/port` and the frame and stream modules it
 * brings; the first framed module that says hello starts the load.
 *
 * Serving and opening stay synchronous for the caller. Until the transport has
 * arrived, a served port is wrapped: every message that reaches it is held and
 * handed to the server, in order, as soon as it attaches, so nothing a module
 * sends early is lost. A client's calls wait for the load and then go out.
 */
import type { ServedContract, ContractClient } from './kernel.ts';

type PortModule = typeof import('@jarenjs/contract/port');

/**
 * A loader that fetches once and keeps what arrived, but not a failure: the
 * next framed window, or a Retry, fetches again.
 */
export function portLoader(load: () => Promise<PortModule>) {
  let loaded: PortModule | null = null;
  let loading: Promise<PortModule> | null = null;
  return {
    load(): Promise<PortModule> {
      loading ??= load().then((module) => (loaded = module), (error) => { loading = null; throw error; });
      return loading;
    },
    get: (): PortModule | null => loaded,
  };
}

const shared = portLoader(() => import('@jarenjs/contract/port'));

/** Start loading the port transport (once) and resolve when it is there. */
export function loadPorts(): Promise<PortModule> { return shared.load(); }

/** Whether the port transport has been loaded. */
export function portsLoaded(): boolean { return shared.get() !== null; }

type Listener = (event: any) => void;

/**
 * A stand-in for `port` that holds what arrives until a listener attaches,
 * then forwards everything, held messages first. Sending goes straight to the
 * real port.
 */
function heldChannel(port: any) {
  const held: any[] = [];
  const listeners = new Set<Listener>();
  const forward = (event: any) => { if (listeners.size) for (const l of listeners) l(event); else held.push(event); };
  port.addEventListener('message', forward);
  port.start?.();
  return {
    postMessage: (...args: unknown[]) => port.postMessage(...args),
    addEventListener(type: string, listener: Listener) {
      if (type !== 'message') return port.addEventListener(type, listener);
      listeners.add(listener);
      for (const event of held.splice(0)) for (const l of listeners) l(event);
    },
    removeEventListener(type: string, listener: Listener) {
      if (type !== 'message') return port.removeEventListener(type, listener);
      listeners.delete(listener);
    },
    start() {},
    close() { port.removeEventListener('message', forward); held.length = 0; listeners.clear(); },
  };
}

/** Serve `contract` on `options.channel`, now when the transport is loaded, else as soon as it is. */
export function servePortLazily(contract: any, handlers: Record<string, any>, options: { channel: any }): ServedContract {
  const ports = shared.get();
  if (ports) return ports.servePort(contract, handlers, options as any) as ServedContract;
  const channel = heldChannel(options.channel);
  let served: ServedContract | null = null;
  let closed = false;
  loadPorts().then((loaded) => {
    if (closed) return;
    served = loaded.servePort(contract, handlers, { ...options, channel } as any) as ServedContract;
  }, () => { /* held messages stay unanswered; the caller's own timeout reports it */ });
  return { close() { closed = true; served?.close?.(); channel.close(); } };
}

/** Open a client on `options.channel`; its calls wait for the transport if it is still loading. */
export function openPortClientLazily(contract: any, options: { channel: any, timeoutMs?: number }): ContractClient {
  const ports = shared.get();
  if (ports) return ports.openPortClient(contract, options as any) as unknown as ContractClient;
  let client: any = null;
  let closed = false;
  const ready = loadPorts().then((loaded) => {
    if (!closed) client = loaded.openPortClient(contract, options as any);
    return client;
  });
  ready.catch(() => { /* each call reports the failed load */ });
  const lazy: any = {
    invoke: async (op: string, input: unknown, callOptions?: unknown) => {
      const c = client ?? await ready;
      if (!c) throw new Error('the client was closed before the port transport loaded');
      return c.invoke(op, input, callOptions);
    },
    close: () => { closed = true; client?.close?.(); },
  };
  return lazy as ContractClient;
}
