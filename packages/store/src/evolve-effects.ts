/**
 * The suite's external-effect store, on the Tangle database.
 *
 * `createDbEffectStore` wants a client shaped a particular way —
 * `collections` as an object it can look a name up in, a `transaction`
 * whose view exposes `collections[name]` and `jobs`, and a `close` whose
 * mere presence selects an immediate transaction. The Jaren store exposes
 * a `collection(name)` METHOD instead, so this module is the one place
 * that adapts between the two.
 *
 * It is deliberately the only such adapter. An effect log is the record of
 * what actually happened outside the process, and a second one — written
 * by a different path, under different rules — would make "what happened"
 * a question with two answers.
 */

import { createDbEffectStore } from '@jarenjs/linq/db';
import type { TangleDb } from './db.ts';

export interface EvolveEffectStoreOptions {
  collection?: string;
  maxLegs?: number;
  maxBytes?: number;
}

/**
 * The fenced effect store for experiments. `evolve_effects` is declared in
 * the model; nothing else writes it.
 */
export function createEvolveEffectStore(db: TangleDb, options: EvolveEffectStoreOptions = {}) {
  const collection = options.collection ?? 'evolve_effects';

  const view = (tx: { collection: (name: string) => unknown, jobs?: unknown }) => ({
    collections: { [collection]: tx.collection(collection) },
    jobs: tx.jobs,
  });

  const client = {
    // The name has to be an OWN property for the mapping check to find it.
    collections: { [collection]: true },
    transaction: <T>(task: (tx: unknown) => Promise<T>, opts?: unknown) =>
      (db as unknown as { transaction: (fn: (tx: unknown) => Promise<T>, o?: unknown) => Promise<T> })
        .transaction(inner => task(view(inner as { collection: (name: string) => unknown, jobs?: unknown })), opts),
    jobs: (db as unknown as { jobs?: unknown }).jobs,
    close: () => (db as unknown as { close: () => Promise<void> }).close(),
  };

  return createDbEffectStore(client as never, {
    operations: collection,
    maxLegs: options.maxLegs ?? 64,
    maxBytes: options.maxBytes ?? 262144,
  });
}
