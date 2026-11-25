/**
 * The runtime in a browser: background jobs run in a dedicated worker of the
 * page, never the page itself, and every tab of the origin reads them.
 *
 * Every tab starts a worker (`startTwin`); the workers queue on one Web Lock,
 * and the one holding it owns the store (SQLite on OPFS, else an IndexedDB
 * snapshot, else memory), runs the registry and serves the `job_queue`
 * contract on a BroadcastChannel every tab's page is a client of
 * (`browserJobQueue`). Closing the owner's tab releases the lock and a waiting
 * worker takes over the same store. A page that is about to be frozen or
 * hidden ends its worker (a frozen tab keeps its lock: measured), and starts
 * a new one when it resumes.
 *
 * A job whose handler is `{ contract: 'desktop', operation }` calls back to
 * the owner's own page, which serves its tasks to its worker: the page's data
 * stays in the page.
 */
import { compileContract } from '@jarenjs/contract';
import { servePort, openPortClient } from '@jarenjs/contract/port';
import { openStore } from '@jarenjs/db';
import { wasmDriver, sqlite3Handle, indexedDbSnapshotHandle } from '@jarenjs/db/wasm';
import { jobSchedules } from '@jarenjs/db/schedules';
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { JOB_QUEUE_CONTRACT, type JobQueue } from '@tangleai/os/jobs';
import { portJobQueue, jobQueuePortClient } from './port-queue.ts';
import { OPS_EVENTS_COLLECTIONS } from './events.ts';
import { createOpsRuntime, type OpsContract, type OpsJobRef } from './runtime.ts';
import { jobQueueHandlers, jobQueueProvider } from './provider.ts';
import type { JobRegistry } from './registry.ts';

/** Where the owner keeps the store: durable on OPFS or IndexedDB, or only in memory. */
export type TwinStorage = 'opfs-sahpool' | 'indexeddb-snapshot' | 'memory';
/** What a worker tells its page. */
export type TwinState =
  | { ops: 'waiting', tab?: string }
  | { ops: 'owner', storage: TwinStorage, failures: { storage: TwinStorage, reason: string }[], tab?: string }
  | { ops: 'error', message: string, tab?: string }
  | { ops: 'stopped', tab?: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Whether an error means another context still holds the OPFS access handles
 * (`NoModificationAllowedError` anywhere in its cause chain) — a handover in
 * progress, retried, never read as "OPFS is unavailable".
 */
export function accessHandleHeld(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: any = error;
  while (e !== null && typeof e === 'object' && !seen.has(e)) {
    if (e.name === 'NoModificationAllowedError') return true;
    seen.add(e);
    e = e.cause;
  }
  return false;
}

/** The storage ladder: OPFS (a held handle retried up to `holdMs`), else an IndexedDB snapshot, else memory. */
/** Whether opening failed because the database file is damaged (SQLite's CORRUPT or NOTADB), not for any other reason. */
export function damaged(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: any = error; e && typeof e === 'object' && !seen.has(e); e = e.cause) {
    seen.add(e);
    if (/SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed|file is not a database|database file is corrupt/i.test(String(e.message ?? ''))) return true;
  }
  return false;
}

async function openDurable(sqlite3: any, scope: any, pool: string, databaseName: string, holdMs: number) {
  const failures: { storage: TwinStorage, reason: string }[] = [];
  const deadline = Date.now() + holdMs;
  for (let delay = 50; ; delay = Math.min(delay * 2, 1000)) {
    try {
      const util = await sqlite3.installOpfsSAHPoolVfs({ name: pool, forceReinitIfPreviouslyFailed: true });
      const probe = `${databaseName}.probe`;
      const db = new util.OpfsSAHPoolDb(probe, 'c');
      try { db.exec('CREATE TABLE IF NOT EXISTS probe(n); DELETE FROM probe; INSERT INTO probe VALUES(73)'); } finally { db.close(); }
      await util.unlink(probe);
      return { storage: 'opfs-sahpool' as TwinStorage, handle: sqlite3Handle(sqlite3, { DbClass: util.OpfsSAHPoolDb }), failures,
        remove: async () => { await util.unlink(databaseName); await util.unlink(`${databaseName}-journal`); } };
    } catch (error) {
      if (accessHandleHeld(error) && Date.now() + delay < deadline) { await sleep(delay); continue; }
      failures.push({ storage: 'opfs-sahpool', reason: String((error as any)?.message ?? error).slice(0, 200) });
      break;
    }
  }
  try {
    if (!scope.indexedDB) throw new Error('IndexedDB is unavailable');
    return { storage: 'indexeddb-snapshot' as TwinStorage, handle: indexedDbSnapshotHandle(sqlite3, { name: `${databaseName}-snapshot`, indexedDB: scope.indexedDB }), failures,
      remove: () => new Promise<void>(done => { const r = scope.indexedDB.deleteDatabase(`${databaseName}-snapshot`); r.onsuccess = r.onerror = r.onblocked = () => done(); }) };
  } catch (error) {
    failures.push({ storage: 'indexeddb-snapshot', reason: String((error as any)?.message ?? error).slice(0, 200) });
  }
  return { storage: 'memory' as TwinStorage, handle: sqlite3Handle(sqlite3), failures, remove: async () => {} };
}

/** What a page task receives: the job it runs for, its idempotency key when it may repeat, and the job's input. */
export type TaskCall<I = Record<string, unknown>> = { job: OpsJobRef, key?: string, input: I };
const TASK_CALL = {
  type: 'object', additionalProperties: false, required: ['job', 'input'],
  properties: {
    job: { type: 'object', additionalProperties: false, required: ['id', 'attempt', 'kind'], properties: { id: { type: 'string', maxLength: 512 }, attempt: { type: 'integer', minimum: 1 }, kind: { type: 'string', maxLength: 200 } } },
    key: { type: 'string', maxLength: 512 }, input: { type: 'object' },
  },
} as const;

/**
 * The contract a page serves its worker for `{ contract: 'desktop', operation }` jobs: one command per operation,
 * each taking a `TaskCall` (the job, its key, its input) and answering an object.
 */
export function desktopTaskContract(operations: Record<string, { doc: string }>): object {
  return {
    $contract: '0.1', id: 'desktop_tasks',
    operations: Object.fromEntries(Object.entries(operations).map(([op, { doc }]) => [op, { kind: 'command', doc, input: TASK_CALL, output: { type: 'object' } }])),
  };
}

/** The runtime's client for the page's tasks: every call carries its job, over the worker's port. */
function desktopClient(port: any): OpsContract {
  const call = (operation: string, input: unknown, ctx: { job?: OpsJobRef, idempotencyKey?: string, signal?: AbortSignal } = {}) =>
    port.invoke(operation, { job: ctx.job ?? { id: 'unknown', attempt: 1, kind: 'unknown' }, ...(ctx.idempotencyKey ? { key: ctx.idempotencyKey } : {}), input: input ?? {} }, ctx.signal ? { signal: ctx.signal } : undefined);
  return { invoke: call, invokeJob: call };
}

export type BrowserOpsOptions = {
  /** The worker's global scope (`self`). */
  scope: any,
  /** Loads SQLite-wasm (`@sqlite.org/sqlite-wasm`'s initializer, its wasm beside the worker script). */
  initialize: () => Promise<any>,
  registry: JobRegistry,
  channelName: string,
  lockName: string,
  databaseName: string,
  pool: string,
  /** The contract the owner's page serves for `{ contract: 'desktop' }` handlers (`desktopTaskContract`). */
  taskContract?: object,
  /** Code handlers that run in the worker itself (`{ code }` jobs). */
  handlers?: Record<string, (payload: unknown, ctx: { job: any, signal?: AbortSignal }) => Promise<unknown>>,
  /** The tab this worker belongs to (its owner id in `jobs.health`). */
  tab?: string,
  zoneProvider?: unknown,
  now?: () => number,
  /** How long a handle the previous owner still holds is waited for (default 10 s). */
  holdMs?: number,
  heartbeatMs?: number,
};

/** Worker side: wait for the lock, then own the store, run the registry and serve the queue to every tab. */
export function startBrowserOps(options: BrowserOpsOptions): { stop(): Promise<void> } {
  const { scope } = options;
  const post = (message: TwinState) => scope.postMessage({ ...message, ...(options.tab ? { tab: options.tab } : {}) });
  let stopped = false, release: (() => void) | null = null;
  let store: any = null, runtime: any = null, server: any = null, channel: any = null, tasks: any = null;
  post({ ops: 'waiting' });
  // queued, not ifAvailable: a waiting tab takes over when the owner's tab closes
  void scope.navigator.locks.request(options.lockName, async () => {
    if (stopped) return;
    try {
      const sqlite3 = await options.initialize();
      const opened = await openDurable(sqlite3, scope, options.pool, options.databaseName, options.holdMs ?? 10_000);
      const zoneProvider = options.zoneProvider ?? createIntlZoneProvider({ revision: 'browser ICU' });
      const open = () => openStore({ $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } } as any, {
        driver: wasmDriver(opened.handle), path: options.databaseName,
        runtime: createRuntime({ zoneProvider: zoneProvider as any, ...(options.now ? { now: options.now } : {}) }),
        jobs: { schedules: jobSchedules() },
      } as any);
      // A store that will not open because its file is damaged (seen once in Firefox, under heavy load, after a reload
      // cut a write) is removed and started fresh: the jobs come back from the registry, only the history is lost, and
      // the heartbeat says when (`recovered`) so the Jobs app can tell the person.
      let recovered: string | undefined;
      try { store = await open(); }
      catch (error) {
        if (!damaged(error)) throw error;
        await opened.remove();
        store = await open();
        recovered = new Date((options.now ?? Date.now)()).toISOString();
      }
      tasks = options.taskContract ? openPortClient(compileContract(options.taskContract as any), { channel: scope, timeoutMs: 30_000 }) : null;
      runtime = createOpsRuntime({
        store, registry: options.registry, contracts: tasks ? { desktop: desktopClient(tasks) } : {}, ...(options.handlers ? { handlers: options.handlers } : {}),
        id: `${options.registry.name}@browser`, about: { storage: opened.storage, ...(options.tab ? { owner: options.tab } : {}), ...(recovered ? { recovered } : {}) },
        ...(options.now ? { now: options.now } : {}), ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
        worker: { pollInterval: 1000 },
      });
      await runtime.start();
      channel = new scope.BroadcastChannel(options.channelName);
      server = servePort(compileContract(JOB_QUEUE_CONTRACT as any), jobQueueHandlers(jobQueueProvider(store, { runtime })) as any, { channel });
      post({ ops: 'owner', storage: opened.storage, failures: opened.failures });
    } catch (error: any) {
      post({ ops: 'error', message: String(error?.message ?? error).slice(0, 500) });
    }
    // hold the lock for the worker's life (or until stop)
    await new Promise<void>(resolve => { release = resolve; if (stopped) resolve(); });
  });
  return {
    async stop() {
      stopped = true;
      try { await runtime?.stop({ graceMs: 1000 }); } catch { /* stopping */ }
      try { server?.close?.(); tasks?.close?.(); channel?.close?.(); } catch { /* closing */ }
      try { await store?.close(); } catch { /* closing */ }
      release?.();
    },
  };
}

/**
 * Page side: the queue the owning worker serves on `channelName`. No answer within `timeoutMs` is `OS0195`:
 * the background runtime is starting (or changing tabs), not missing.
 */
export function browserJobQueue(options: { channelName: string, timeoutMs?: number, channel?: any }): JobQueue {
  return portJobQueue(jobQueuePortClient(options.channel ?? new BroadcastChannel(options.channelName), options.timeoutMs ?? 5_000));
}

export type TwinOptions = {
  /** The worker's script; the page adds `tab`, `channel` and `lock` to its query. */
  workerUrl: URL | string,
  channelName: string,
  lockName: string,
  /** The tasks this page serves its worker for `{ contract: 'desktop' }` jobs, with their contract. */
  taskContract?: object,
  tasks?: Record<string, (input: any) => Promise<unknown>>,
  onState?: (state: TwinState) => void,
  /** The page's window (default `globalThis`). */
  scope?: any,
  tab?: string,
};

/**
 * Page side: start this tab's worker and keep it right across the page's lifecycle — ended on `freeze` and
 * `pagehide` (a frozen tab would keep the lock from every other tab), started again on `resume` and on a
 * `pageshow` from the back/forward cache.
 */
export function startTwin(options: TwinOptions): { stop(): void, tab: string } {
  const scope = options.scope ?? globalThis;
  const tab = options.tab ?? scope.crypto.randomUUID();
  let worker: any = null, server: any = null;
  const compiledTasks = options.taskContract && options.tasks ? compileContract(options.taskContract as any) : null;
  const start = () => {
    if (worker) return;
    const url = new URL(String(options.workerUrl), scope.location?.href);
    url.searchParams.set('tab', tab); url.searchParams.set('channel', options.channelName); url.searchParams.set('lock', options.lockName);
    worker = new scope.Worker(url, { type: 'module' });
    worker.addEventListener('message', (event: any) => { if (event.data && typeof event.data.ops === 'string') options.onState?.(event.data); });
    worker.addEventListener('error', (event: any) => options.onState?.({ ops: 'error', message: String(event?.message ?? 'the worker failed'), tab }));
    if (compiledTasks) server = servePort(compiledTasks, options.tasks as any, { channel: worker });
  };
  const end = () => {
    if (!worker) return;
    try { server?.close?.(); } catch { /* closing */ }
    worker.terminate();   // a terminated worker releases its locks and its OPFS handles
    worker = server = null;
    options.onState?.({ ops: 'stopped', tab });
  };
  const onShow = (event: any) => { if (event.persisted) start(); };
  // the Page Lifecycle's freeze and resume are the document's events; pagehide and pageshow the window's
  const doc = scope.document;
  doc?.addEventListener?.('freeze', end);
  doc?.addEventListener?.('resume', start);
  scope.addEventListener?.('pagehide', end);
  scope.addEventListener?.('pageshow', onShow);
  start();
  return {
    tab,
    stop() {
      doc?.removeEventListener?.('freeze', end); doc?.removeEventListener?.('resume', start);
      scope.removeEventListener?.('pagehide', end); scope.removeEventListener?.('pageshow', onShow);
      end();
    },
  };
}

/**
 * Forget the browser runtime's data: the OPFS pool directory and the IndexedDB snapshot. Stop the twin
 * first — a worker that still holds the pool's handles keeps its files.
 */
export async function forgetBrowserOps(options: { databaseName: string, pool: string, storage?: { getDirectory(): Promise<any> }, indexedDB?: any }): Promise<{ opfs: boolean, indexedDB: boolean }> {
  const storage = options.storage ?? (globalThis as any).navigator?.storage;
  const idb = options.indexedDB ?? (globalThis as any).indexedDB;
  let opfs = false, snapshot = false;
  try {
    const root = await storage?.getDirectory();
    if (root) { await root.removeEntry(`.${options.pool}`, { recursive: true }); opfs = true; }
  } catch (error: any) { if (error?.name === 'NotFoundError') opfs = true; }
  if (idb) {
    snapshot = await new Promise<boolean>(resolve => {
      const request = idb.deleteDatabase(`${options.databaseName}-snapshot`);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    });
  }
  return { opfs, indexedDB: snapshot };
}
