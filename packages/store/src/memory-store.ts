/**
 * The MemoryStore contract over a @jarenjs/db collection.
 *
 * Same four methods, same write gate, same isolation guarantees as
 * `createMemoryUnitStore` — the policies in @tangleai/memory cannot tell
 * the difference, which is the whole point of the seam (and the delivery
 * of TODO order 10's first half: "replace the in-memory store behind the
 * SAME 4-method contract, node:sqlite first").
 *
 * Isolation comes free: every read is a fresh parse out of SQLite, every
 * write serializes the document — no caller ever holds a live reference
 * into the store.
 */

import { JarenValidator } from '@jarenjs/validate';
import { callerError } from '@tangleai/core/errors';
import {
  MEMORY_UNIT_SCHEMA,
  MEMORY_RELATION_SCHEMA,
  type MemoryUnit,
} from '@tangleai/core/schemas/memory';
import type { MemoryStore } from '@tangleai/memory/store';

import type { DbCollection } from './db.ts';

const LIST_ALL = { $for: { u: '$[*]' }, $return: '$u' };

/**
 * @jarenjs/db's query engine answers with sequence semantics: an array
 * for many rows, the bare value for exactly one, `undefined` for none.
 * Every Tangle row is an object, so the disambiguation is total.
 */
export function asRows<T>(result: unknown): T[] {
  if (result === undefined) return [];
  return (Array.isArray(result) ? result : [result]) as T[];
}

export interface DbMemoryStoreOptions {
  validator?: JarenValidator<true>;
}

export function createDbMemoryStore(
  collection: DbCollection,
  options: DbMemoryStoreOptions = {},
): MemoryStore {
  const validator = options.validator
    ?? new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  validator.addSchema(MEMORY_RELATION_SCHEMA);
  const validate = validator.compile(MEMORY_UNIT_SCHEMA);

  return {
    async get(id: string): Promise<MemoryUnit | undefined> {
      const doc = await collection.get(id);
      return doc === undefined ? undefined : (doc as MemoryUnit);
    },
    async put(unit: MemoryUnit): Promise<void> {
      const outcome = validate(unit);
      if (outcome.valid !== true) {
        throw callerError(
          `memory unit rejected by MEMORY_UNIT_SCHEMA: ${JSON.stringify(outcome.errors)}`,
        );
      }
      await collection.put(unit);
    },
    async delete(id: string): Promise<void> {
      await collection.delete(id);
    },
    async list(): Promise<MemoryUnit[]> {
      return asRows<MemoryUnit>(await collection.execute(LIST_ALL));
    },
  };
}
