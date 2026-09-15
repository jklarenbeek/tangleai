/**
 * Assembling the desktop: one SQLite file, one contract dispatcher, one
 * static file layer — importable (tests drive `dispatcher.dispatch`
 * with plain objects, no socket) and runnable (main.ts binds node:http,
 * which Bun also implements, so the same file serves both runtimes).
 *
 * Static serving prefers the on-disk `public/` (dev); a compiled binary
 * carries the same files through `assets.gen.ts`, which is a committed
 * empty stub that `npm run desktop:compile` temporarily populates (see
 * scripts/embed-assets.ts).
 */

import { readFile } from 'node:fs/promises';
import manifest from '../package.json' with { type: 'json' };
import { createRuntime } from '@jarenjs/core/runtime';

import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { createScheduler } from '@jarenjs/core/schedule';
import { createDbMemoryStore, createDocumentStore, createIdentityRepository, createOutcomeStore, createRunLog, openTangleDb, type TangleDb } from '@tangleai/store';
import { SafeStaticFetcher, type StaticFetchOptions } from '@tangleai/documents';

import { DESKTOP_CONTRACT } from './contract.ts';
import { ASSETS } from './assets.gen.ts';
import { createFolderSync, createHandlers } from './handlers.ts';
import { createSettingsStore, type Settings } from './settings.ts';
import { createChatEngine } from './chat.ts';
import { createFeedbackService } from './feedback.ts';
import { createReportService } from './reports.ts';
import type { InstrumentRunner } from './instruments.ts';
import { settingsStack } from './ai-host.ts';
import { createFolderWatcher, type FolderWatchSeams, type FolderWatcher } from './watch.ts';

/** The run kinds that must say what stack produced them. */
export const CONFIG_AWARE_RUN_KINDS = ['sync', 'document', 'documents', 'chat'] as const;

/**
 * How much chat runs in parallel, and how deep the wait goes before a
 * request is refused rather than queued behind an unbounded backlog.
 */
export const CHAT_ADMISSION = { concurrency: 2, maxQueue: 8 } as const;

/**
 * One folder pass at a time, whoever asked, with room for exactly one
 * to wait: a click during a watcher pass is served, and the request
 * behind that one is refused rather than queued.
 */
export const FOLDER_ADMISSION = { concurrency: 1, maxQueue: 1 } as const;

/**
 * One instrument at a time, with room for two to wait: a measurement is
 * minutes of a whole CPU, and a queue deeper than the operator can hold
 * in mind is a backlog rather than a plan.
 */
export const REPORT_ADMISSION = { concurrency: 1, maxQueue: 2 } as const;

export const DESKTOP_VERSION = manifest.version;

/** How this host watches its folder; off unless the host asks for it. */
export interface DesktopWatchOptions extends Partial<Omit<FolderWatchSeams, 'now'>> {
  enabled?: boolean;
  debounceMs?: number;
  maxEventsPerWindow?: number;
  tickMs?: number | null;
}

export interface DesktopOptions {
  dbPath?: string;
  driver?: any;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  runtime?: ReturnType<typeof createRuntime>;
  presetSettings?: Partial<Settings>;
  documentFetch?: Omit<StaticFetchOptions, 'fetch' | 'now'>;
  watch?: DesktopWatchOptions;
  /**
   * What this host can measure. A host that has no measurement
   * workspace beside it passes nothing, and the surface says so — the
   * desktop never imports an instrument.
   */
  instruments?: InstrumentRunner;
}

export interface Desktop {
  db: TangleDb;
  watcher: FolderWatcher;
  dispatcher: {
    dispatch: (request: any) => Promise<any>,
    close: () => Promise<void> | void,
    capabilities: any,
    contract: any,
    describe: () => any,
  };
  nodeHandler: (req: any, res: any) => void;
  close(): Promise<void>;
}

export async function createDesktop(options: DesktopOptions = {}): Promise<Desktop> {
  const runtime = options.runtime ?? createRuntime();
  const now = options.now ?? (() => new Date(runtime.now()).toISOString());
  // live queries are maintained from the capture stream, so the store
  // is opened with capture on whichever mechanism the runtime has
  // (`session` under Node, `journal` under Bun); the suite's live bounds
  // stand, and a run that crosses them is an answered overflow, not a
  // raised ceiling
  const db = await openTangleDb({ path: options.dbPath, driver: options.driver, runtime, capture: { mode: 'auto' } });
  const memoryStore = createDbMemoryStore(db.collection('memories'));
  const runLog = createRunLog(db, { now, configAwareKinds: CONFIG_AWARE_RUN_KINDS });
  const identities = createIdentityRepository(db);
  const documentStore = createDocumentStore(db);
  const documentFetcher = new SafeStaticFetcher({
    ...options.documentFetch,
    fetch: options.fetch,
    now,
    schedule: { now: runtime.now, ...options.documentFetch?.schedule },
  });
  const settings = createSettingsStore(db);
  if (options.presetSettings !== undefined) await settings.write(options.presetSettings);
  // one controller per running chat run, never a latest slot: cancelling
  // names the run it ends
  const inflight = new Map<string, AbortController>();
  // the outcome lifecycle owns evidence, replay and projection; this host
  // supplies the domain, the trusted resolver and the scope, and nothing
  // else in the desktop writes an outcome record
  const feedback = await createFeedbackService({
    db, memoryStore, identities, outcomeStore: createOutcomeStore(db), now,
  });
  const chatScheduler = createScheduler({ ...CHAT_ADMISSION, now: runtime.now });
  const chat = createChatEngine({
    db,
    memoryStore,
    documentStore,
    settings: () => settings.read(),
    stackFor: settingsStack,
    identities,
    runLog,
    inflight,
    scheduler: chatScheduler,
    fetch: options.fetch,
    now,
    ticks: runtime.now,
    recordDecision: feedback.recordDecision,
  });

  const folderScheduler = createScheduler({ ...FOLDER_ADMISSION, now: runtime.now });
  const folderSync = createFolderSync({
    db, memoryStore, runLog, settings, identities,
    stackFor: settingsStack,
    scheduler: folderScheduler,
    fetch: options.fetch,
    now,
  });
  // the watcher asks for the same pass a click asks for; it starts none
  // itself, and every answer it gets is a counted value
  const watcher = createFolderWatcher({
    ...options.watch,
    enabled: options.watch?.enabled ?? false,
    now,
    onScan: async (trigger, admitted) => {
      const outcome = await folderSync.scan(trigger, admitted);
      return { runId: outcome.runId, refused: outcome.ok ? null : outcome.refused };
    },
  });

  const reportScheduler = createScheduler({ ...REPORT_ADMISSION, now: runtime.now });
  const reports = createReportService({
    db, runLog, inflight, scheduler: reportScheduler, now, ticks: runtime.now,
    ...(options.instruments === undefined ? {} : { runner: options.instruments }),
  });

  const contract = compileContract(DESKTOP_CONTRACT);
  const handlers = createHandlers({
    db, memoryStore, runLog, settings, identities, stackFor: settingsStack, inflight, chat, folderSync, watcher, feedback, reports, documentStore, documentFetcher,
    version: DESKTOP_VERSION,
    fetch: options.fetch,
    now,
  });
  const dispatcher = serveHttp(contract, handlers, { validateOutput: 'always', runtime });

  // restart safety is a scan at every start, not a persisted cursor: the
  // content hash already makes a scan idempotent, so this cannot miss an
  // edit made while the process was down. It runs beside the server
  // rather than in front of it — `close()` waits for it.
  const folder = (await settings.read()).folder;
  if (watcher.state().enabled && folder !== null) void watcher.start(folder);

  return {
    db,
    watcher,
    dispatcher,
    nodeHandler: toNodeHandler(dispatcher),
    async close() {
      // the watcher stops asking first, then every scheduler drains the
      // work it admitted, then the dispatcher ends the streams those
      // workers were writing frames for; closing the store last releases
      // every live registration
      await watcher.close();
      await folderScheduler.close();
      await chatScheduler.close();
      await reportScheduler.close();
      await dispatcher.close();
      await documentFetcher.close();
      await db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export interface StaticFile {
  body: string | Uint8Array;
  type: string;
}

/** `path` is the URL pathname; answers undefined when nothing matches. */
export async function staticFile(path: string): Promise<StaticFile | undefined> {
  const clean = path === '/' ? '/index.html' : path;
  if (clean.includes('..') || !clean.startsWith('/')) return undefined;
  const ext = clean.slice(clean.lastIndexOf('.'));
  const type = MIME[ext];
  if (type === undefined) return undefined;

  const name = clean.slice(1);
  try {
    const url = new URL(`../public${clean}`, import.meta.url);
    const body = await readFile(url);
    return { body, type };
  } catch {
    if (name in ASSETS) return { body: ASSETS[name], type };
    return undefined;
  }
}
