/**
 * The OS database worker: SQLite (sqlite-wasm) under `@jarenjs/db`,
 * served over this worker's port through `store.contract.json`.
 *
 * Storage is the most durable this origin offers without asking: the
 * OPFS access-handle pool (no cross-origin isolation needed, so it works
 * on GitHub Pages); when another tab of the OS already holds the pool, or
 * the browser has no OPFS, the database opens in memory and says so in
 * its mode — the page then tells the person their artworks will not
 * survive the tab. The pool is this edition's own: the Jaren edition
 * serves from the same origin and keeps its database apart.
 *
 * The port is served before the first await: a message that arrives
 * while the module is still initializing would otherwise be lost.
 */

import { wasmDriver, sqlite3Handle } from '@jarenjs/db/wasm';
import { initializeSqlite } from '../demos/playground/sqlite.ts';
import { compileContract } from '@jarenjs/contract';
import { servePort } from '@jarenjs/contract/port';
import storeDoc from './documents/store.contract.json' with { type: 'json' };
import { openOsStore } from './kernel/store.ts';
import type { StoreHandlers } from './kernel/store.ts';

const scope = globalThis as any;

const ready = (async () => {
  // the wasm and the OPFS proxy are copied next to this worker
  const sqlite3: any = await initializeSqlite({ locateFile: (name) => new URL(name, import.meta.url).href, print: () => {}, printErr: () => {} });
  let DbClass = sqlite3.oo1.DB;
  let path = ':memory:';
  let mode = 'memory';
  let detail = 'this browser offers the OS no private file system, so kept artworks last until the tab closes';
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'radiant-os-tangle' });
    DbClass = pool.OpfsSAHPoolDb;
    path = '/radiant-os.db';
    mode = 'sqlite on OPFS';
    detail = 'kept in this browser, offline, across visits';
  }
  catch (error: any) {
    if (error?.name === 'NoModificationAllowedError') {
      detail = 'another Radiant OS tab holds the database, so this tab keeps its artworks in memory';
    }
  }
  return openOsStore({ driver: (wasmDriver as any)((sqlite3Handle as any)(sqlite3, { DbClass })), path, mode, detail });
})();

const contract = compileContract(storeDoc as any);
const handlers: StoreHandlers = {};
for (const op of Object.keys(storeDoc.operations)) {
  handlers[op] = async (input: any) => (await ready).handlers[op](input);
}
servePort(contract, handlers as any, { channel: scope } as any);

ready.then(
  () => scope.postMessage({ radiant: 'ready' }),
  (error: any) => scope.postMessage({ radiant: 'failed', reason: String(error?.message ?? error) }),
);
