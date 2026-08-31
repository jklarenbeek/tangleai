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

import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { createDbMemoryStore, createDocumentStore, createIdentityRepository, createRunLog, openTangleDb, type TangleDb } from '@tangleai/store';
import { SafeStaticFetcher, type StaticFetchOptions } from '@tangleai/documents';

import { DESKTOP_CONTRACT } from './contract.ts';
import { ASSETS } from './assets.gen.ts';
import { createHandlers } from './handlers.ts';
import { createLiveHub } from './live.ts';
import { createSettingsStore, type Settings } from './settings.ts';
import { createChatEngine } from './chat.ts';
import { settingsStack } from './ai-host.ts';

/** The run kinds that must say what stack produced them. */
export const CONFIG_AWARE_RUN_KINDS = ['sync', 'document', 'documents'] as const;

export const DESKTOP_VERSION = '0.1.0';

export interface DesktopOptions {
  dbPath?: string;
  driver?: any;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
  presetSettings?: Partial<Settings>;
  documentFetch?: Omit<StaticFetchOptions, 'fetch' | 'now'>;
}

export interface Desktop {
  db: TangleDb;
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
  const db = await openTangleDb({ path: options.dbPath, driver: options.driver });
  const memoryStore = createDbMemoryStore(db.collection('memories'));
  const runLog = createRunLog(db, { now: options.now, configAwareKinds: CONFIG_AWARE_RUN_KINDS });
  const identities = createIdentityRepository(db);
  const documentStore = createDocumentStore(db);
  const documentFetcher = new SafeStaticFetcher({
    ...options.documentFetch,
    fetch: options.fetch,
    now: options.now,
  });
  const settings = createSettingsStore(db);
  if (options.presetSettings !== undefined) await settings.write(options.presetSettings);
  const live = createLiveHub();
  const chat = createChatEngine({
    db,
    memoryStore,
    documentStore,
    settings: () => settings.read(),
    stackFor: settingsStack,
    identities,
    fetch: options.fetch,
    now: options.now,
  });

  const contract = compileContract(DESKTOP_CONTRACT);
  const handlers = createHandlers({
    db, memoryStore, runLog, settings, identities, stackFor: settingsStack, live, chat, documentStore, documentFetcher,
    version: DESKTOP_VERSION,
    fetch: options.fetch,
    now: options.now,
  });
  const dispatcher = serveHttp(contract, handlers, { validateOutput: 'always' });

  return {
    db,
    dispatcher,
    nodeHandler: toNodeHandler(dispatcher),
    async close() {
      await dispatcher.close();
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
