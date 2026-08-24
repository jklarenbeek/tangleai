/**
 * Opening the Tangle database — one call, either runtime.
 *
 * @jarenjs/db ships BOTH drivers and both import their SQLite binding
 * lazily inside `open()` (`lazyOpen`), so importing the two modules at
 * top level is safe everywhere: under Node the `bun:` specifier is never
 * resolved, under Bun `node:sqlite` is never resolved. The pick is one
 * runtime probe: `process.versions.bun`.
 *
 * TS note: `openStore`'s published return type is `Promise<any>` — the
 * handle surface below is OUR structural pin of the store/collection
 * shape (documented in @jarenjs/db's README and store.js typedefs), so
 * every downstream module gets checked calls even though the boundary
 * hands us `any`. Recorded in JARENASK.md.
 */

import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { bunDriver } from '@jarenjs/db/bun';

import { TANGLE_DB_MODEL } from './model.ts';

/** The @jarenjs/db collection handle members Tangle uses. */
export interface DbCollection {
  get(key: string): Promise<any | undefined>;
  insert(doc: any): Promise<string>;
  put(doc: any, key?: string): Promise<string>;
  patch(key: string, ops: any[]): Promise<any>;
  delete(key: string): Promise<boolean>;
  execute(document: any, options?: any): any;
  stats(): any;
}

/** The @jarenjs/db store handle members Tangle uses. */
export interface TangleDb {
  collection(name: string): DbCollection;
  stats(): any;
  close(options?: { graceMs?: number }): Promise<void>;
}

export interface OpenTangleDbOptions {
  /** SQLite file path; defaults to in-memory. */
  path?: string;
  /** Driver override (tests inject `nodeDriver()` explicitly). */
  driver?: any;
}

export function pickDriver(): any {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined
    ? bunDriver()
    : nodeDriver();
}

export async function openTangleDb(options: OpenTangleDbOptions = {}): Promise<TangleDb> {
  const driver = options.driver ?? pickDriver();
  const store = await openStore(TANGLE_DB_MODEL, { driver, path: options.path ?? ':memory:' });
  return store as TangleDb;
}
