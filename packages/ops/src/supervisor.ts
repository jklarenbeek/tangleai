/**
 * The runtime in a host's background thread: a supervisor in the host's main
 * thread starts a `worker_threads` worker that owns the runtime's store and
 * runs the registry, and reads it through the `job_queue` contract over a
 * MessageChannel — so the person's steering reaches the process where the
 * leases live.
 *
 * The supervisor restarts a worker that exits or fails, with a backoff that
 * grows on repeated failures and resets after a quiet while, and it watches
 * the runtime's heartbeat (the watcher is never the watched): a runtime that
 * does not answer its health call is hung and restarted; one that answers
 * with an old heartbeat is restarted only after TWO consecutive old readings,
 * so a laptop's sleep or a slow start is not mistaken for a dead runtime.
 *
 * `runOpsWorker` is the worker entry's half: it opens the store, starts the
 * runtime and serves the contract on the port the supervisor sent it.
 */
import { Worker, MessageChannel, parentPort, workerData } from 'node:worker_threads';
import { servePort } from '@jarenjs/contract/port';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { jobSchedules } from '@jarenjs/db/schedules';
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { JOB_CODES, type JobQueue } from '@tangleai/os/jobs';
import { OPS_EVENTS_COLLECTIONS } from './events.ts';
import { createOpsRuntime, type OpsContract, type OpsHandler, type OpsRuntime } from './runtime.ts';
import { jobQueueHandlers, jobQueueProvider } from './provider.ts';
import { compiledJobQueueContract, jobQueuePortClient, portJobQueue } from './port-queue.ts';
import type { JobRegistry } from './registry.ts';

export type SupervisorState = {
  state: 'starting' | 'running' | 'restarting' | 'stopped',
  /** How many times a worker was started again after an exit, a failure or a stale heartbeat. */
  restarts: number,
  /** Why the last worker ended. */
  last?: { reason: 'exit' | 'error' | 'stale' | 'hung' | 'restart', at: number, code?: number, message?: string },
  /** When the next worker starts, while restarting. */
  nextStartAt?: number,
};
export type SuperviseOptions = {
  /** The worker entry (a module that calls `runOpsWorker`). */
  workerUrl: URL | string,
  /** What the entry needs (its store path, its host module…); the supervisor adds the contract's port. */
  workerData?: Record<string, unknown>,
  restart?: { minMs?: number, maxMs?: number, resetAfterMs?: number },
  /** A heartbeat older than this is stale (default 90 s); the watch reads every third of it. */
  staleAfterMs?: number,
  /** How long a health call may take before the runtime counts as hung (default 10 s). */
  healthTimeoutMs?: number,
  onState?: (state: SupervisorState) => void,
};
export type OpsSupervisor = {
  /** The runtime's queue; while a worker starts or restarts it answers `OS0195`. */
  queue(): JobQueue,
  state(): SupervisorState,
  /** End the current worker and start a new one (an operator's restart). */
  restart(): Promise<void>,
  /** Stop the runtime (its history drained), then end the worker. */
  stop(): Promise<void>,
};

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
const within = <T>(promise: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(coded('OPS0003', 'no answer in time')), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});
const QUEUE_METHODS = ['counts', 'page', 'get', 'schedules', 'cancel', 'requeue', 'unschedule', 'events', 'health', 'registry', 'run'] as const;

/** Supervise a runtime in a worker thread. It starts at once. */
export function superviseOps(options: SuperviseOptions): OpsSupervisor {
  const minMs = options.restart?.minMs ?? 1_000, maxMs = options.restart?.maxMs ?? 60_000, resetAfterMs = options.restart?.resetAfterMs ?? 300_000;
  const staleAfterMs = options.staleAfterMs ?? 90_000, healthTimeoutMs = options.healthTimeoutMs ?? 10_000;
  let current: { worker: Worker, port: any, queue: JobQueue, startedAt: number, running: boolean } | null = null;
  let status: SupervisorState = { state: 'starting', restarts: 0 };
  let failures = 0, stopping = false, staleReadings = 0, pendingStart: ReturnType<typeof setTimeout> | null = null;
  const say = (next: Partial<SupervisorState>) => { status = { ...status, ...next }; if (status.state !== 'restarting') delete status.nextStartAt; options.onState?.(status); };

  function spawn() {
    pendingStart = null;
    if (stopping) return;
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(options.workerUrl, { workerData: { ...(options.workerData ?? {}), port: port2 }, transferList: [port2] });
    const queue = portJobQueue(jobQueuePortClient(port1, 5_000), { what: 'the background runtime' });
    const me = { worker, port: port1, queue, startedAt: Date.now(), running: false };
    current = me;
    staleReadings = 0;
    say({ state: 'starting' });
    worker.on('message', (message: any) => {
      if (message?.ops === 'running' && current === me) { me.running = true; say({ state: 'running' }); }
    });
    worker.on('error', (error) => ended(me, 'error', undefined, String(error?.message ?? error)));
    worker.on('exit', (code) => ended(me, 'exit', code));
  }

  function ended(me: NonNullable<typeof current>, reason: 'exit' | 'error' | 'stale' | 'hung' | 'restart', code?: number, message?: string) {
    if (current !== me) return;   // already handled (an error is followed by its exit)
    current = null;
    try { me.port.close(); } catch { /* closing */ }
    if (stopping) { say({ state: 'stopped' }); return; }
    if (Date.now() - me.startedAt > resetAfterMs) failures = 0;
    const delay = reason === 'restart' ? 0 : Math.min(maxMs, minMs * 2 ** failures);
    if (reason !== 'restart') failures++;
    say({ state: 'restarting', restarts: status.restarts + 1, last: { reason, at: Date.now(), ...(code !== undefined ? { code } : {}), ...(message ? { message: message.slice(0, 300) } : {}) }, nextStartAt: Date.now() + delay });
    pendingStart = setTimeout(spawn, delay);
  }

  async function end(reason: 'stale' | 'hung' | 'restart') {
    const me = current;
    if (!me) return;
    ended(me, reason);
    await me.worker.terminate();
  }

  // the watch: only a running runtime is judged
  const watch = setInterval(async () => {
    const me = current;
    if (!me || !me.running || stopping) return;
    let health: any;
    try { health = await within(me.queue.health({}), healthTimeoutMs); }
    catch { if (current === me) await end('hung'); return; }
    if (current !== me) return;
    const newest = Math.max(0, ...(health?.runtimes ?? []).map((r: any) => r.at ?? 0));
    const old = newest === 0 || health.now - newest > staleAfterMs;
    staleReadings = old ? staleReadings + 1 : 0;
    if (staleReadings >= 2) await end('stale');
  }, Math.max(50, Math.floor(staleAfterMs / 3)));
  (watch as any).unref?.();

  const facade = Object.fromEntries(QUEUE_METHODS.map(m => [m, (input: any) => {
    if (!current || !current.running) return Promise.reject(coded(JOB_CODES.starting, 'the background runtime is starting'));
    return (current.queue as any)[m](input);
  }])) as unknown as JobQueue;

  spawn();
  return {
    queue: () => facade,
    state: () => status,
    async restart() { await end('restart'); },
    async stop() {
      stopping = true;
      clearInterval(watch);
      if (pendingStart) { clearTimeout(pendingStart); pendingStart = null; }
      const me = current;
      if (!me) { say({ state: 'stopped' }); return; }
      const exited = new Promise<void>(resolve => me.worker.once('exit', () => resolve()));
      me.worker.postMessage({ ops: 'stop' });
      const drained = await Promise.race([exited.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 10_000))]);
      if (!drained) await me.worker.terminate();
      if (current === me) ended(me, 'exit');
    },
  };
}

export type OpsWorkerOptions = {
  /** The runtime's own store file (SQLite). */
  storePath: string,
  registry: JobRegistry,
  handlers?: Record<string, OpsHandler>,
  contracts?: Record<string, OpsContract>,
  id?: string,
  now?: () => number,
  keepDays?: number,
  heartbeatMs?: number,
  worker?: { concurrency?: number, pollInterval?: number, leaseMs?: number },
};

/**
 * The worker entry's half: open the store, start the runtime, serve the contract on the supervisor's port,
 * and stop (history drained, store closed) when asked. Resolves with the runtime once it runs.
 */
export async function runOpsWorker(options: OpsWorkerOptions): Promise<OpsRuntime> {
  const port = (workerData as any)?.port;
  if (!port || !parentPort) throw new TypeError('runOpsWorker runs in a worker started by superviseOps');
  const store: any = await openStore({ $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } } as any, {
    driver: nodeDriver(), path: options.storePath,
    runtime: createRuntime({ zoneProvider: createIntlZoneProvider({ revision: 'host ICU' }), ...(options.now ? { now: options.now } : {}) }),
    jobs: { schedules: jobSchedules() },
  } as any);
  const runtime = createOpsRuntime({
    store, registry: options.registry,
    ...(options.handlers ? { handlers: options.handlers } : {}), ...(options.contracts ? { contracts: options.contracts } : {}),
    id: options.id ?? `${options.registry.name}@worker`,
    ...(options.now ? { now: options.now } : {}), ...(options.keepDays ? { keepDays: options.keepDays } : {}),
    ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}), ...(options.worker ? { worker: options.worker } : {}),
  });
  await runtime.start();
  const server = servePort(compiledJobQueueContract(), jobQueueHandlers(jobQueueProvider(store, { runtime })) as any, { channel: port });
  port.start?.();
  parentPort.on('message', async (message: any) => {
    if (message?.ops !== 'stop') return;
    try { await runtime.stop({ graceMs: 5_000 }); } catch { /* stopping */ }
    try { server.close?.(); } catch { /* closing */ }
    try { await store.close(); } catch { /* closing */ }
    try { port.close(); } catch { /* closing */ }
    process.exit(0);
  });
  parentPort.postMessage({ ops: 'running' });
  return runtime;
}
