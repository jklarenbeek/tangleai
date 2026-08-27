/**
 * The MemoryStore contract over a @jarenjs/db collection.
 *
 * Same four methods, same write gate, same isolation guarantees as
 * `createMemoryUnitStore` — the policies in @tangleai/memory cannot tell
 * the difference, which is the whole point of the seam: the in-memory
 * store is replaced behind the SAME 4-method contract, node:sqlite first.
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
import type { SequenceResult } from '@jarenjs/db';

import type { DbCollection } from './db.ts';

const LIST_ALL = { $for: { u: '$[*]' }, $return: '$u' };

/**
 * @jarenjs/db's `execute` answers in the engine's result shape,
 * `SequenceResult<T>`: `undefined` for no rows, the item itself for
 * exactly one, an array for more. Every Tangle row is an object, so
 * the disambiguation is total (an array-valued item would not be).
 */
export function asRows<T>(result: SequenceResult<T>): T[] {
  if (result === undefined) return [];
  const rows: T[] = [];
  return rows.concat(result);
}

export interface DbMemoryStoreOptions {
  validator?: JarenValidator<true>;
}

export function createDbMemoryStore(
  collection: DbCollection<MemoryUnit>,
  options: DbMemoryStoreOptions = {},
): MemoryStore {
  const validator = options.validator
    ?? new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  validator.addSchema(MEMORY_RELATION_SCHEMA);
  const validate = validator.compile(MEMORY_UNIT_SCHEMA);

  return {
    async get(id: string): Promise<MemoryUnit | undefined> {
      return collection.get(id);
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
      return asRows(await collection.execute<MemoryUnit>(LIST_ALL));
    },
  };
}
