/**
 * Opening the Tangle database — one call, either runtime.
 *
 * @jarenjs/db ships BOTH drivers and both import their SQLite binding
 * lazily inside `open()` (`lazyOpen`), so importing the two modules at
 * top level is safe everywhere: under Node the `bun:` specifier is never
 * resolved, under Bun `node:sqlite` is never resolved. The pick is one
 * runtime probe: `process.versions.bun`.
 *
 * The handles are @jarenjs/db's own published types — `Store` from
 * `openStore`, `Collection<T>` from `store.collection<T>(name)` with the
 * document shape stated where the handle is taken — so nothing about
 * the store's surface is restated here; the two aliases only keep
 * Tangle's names.
 */

import { openStore, type Collection, type OpenStoreOptions, type Store } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { bunDriver } from '@jarenjs/db/bun';

import { TANGLE_DB_MODEL } from './model.ts';

/** A @jarenjs/db collection handle over documents of shape `T`. */
export type DbCollection<T = unknown> = Collection<T>;

/** The @jarenjs/db store handle. */
export type TangleDb = Store;

export interface OpenTangleDbOptions {
  /** SQLite file path; defaults to in-memory. */
  path?: string;
  /** Driver override (tests inject `nodeDriver()` explicitly). */
  driver?: OpenStoreOptions['driver'];
}

export function pickDriver(): OpenStoreOptions['driver'] {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined
    ? bunDriver()
    : nodeDriver();
}

export function openTangleDb(options: OpenTangleDbOptions = {}): Promise<TangleDb> {
  const driver = options.driver ?? pickDriver();
  return openStore(TANGLE_DB_MODEL, { driver, path: options.path ?? ':memory:' });
}
