/**
 * The memory store seam and its default in-memory implementation.
 *
 * The contract is four async methods — `get`, `put`, `delete`, `list` —
 * the same injection shape as the @jarenjs/ai ledger's storage seam, one
 * level up: this store holds validated memory UNITS, not raw strings.
 * A host backs it with SQLite, OPFS, a graph database, whatever; the
 * policies in this package only ever see the contract.
 *
 * Every `put` is validated against `MEMORY_UNIT_SCHEMA`. The rule is the
 * ledger's rule: a malformed write is rejected at the boundary, because
 * a store that accepts junk makes every later policy pass unsound.
 * Records are JSON-cloned on the way in and out, so no caller holds a
 * live reference into the store — mutation happens through `put`, or
 * not at all.
 *
 * TS note: `JarenValidator<true>` (inferred from `collectErrors: true`)
 * makes `compile()` return a collector whose outcome is a typed
 * `{ valid, errors }` — the shape-reading dance the JS version did is
 * carried by the published d.ts now.
 */

import { JarenValidator } from '@jarenjs/validate';
import { callerError } from '@tangleai/core/errors';
import {
  MEMORY_UNIT_SCHEMA,
  MEMORY_RELATION_SCHEMA,
  type MemoryUnit,
} from '@tangleai/core/schemas/memory';

export interface MemoryStore {
  get(id: string): Promise<MemoryUnit | undefined>;
  put(unit: MemoryUnit): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<MemoryUnit[]>;
}

export interface MemoryUnitStoreOptions {
  validator?: JarenValidator<true>;
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function createMemoryUnitStore(options: MemoryUnitStoreOptions = {}): MemoryStore {
  const validator = options.validator
    ?? new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  validator.addSchema(MEMORY_RELATION_SCHEMA);
  const validate = validator.compile(MEMORY_UNIT_SCHEMA);

  const units = new Map<string, MemoryUnit>();

  return {
    async get(id) {
      return clone(units.get(id));
    },
    async put(unit) {
      const outcome = validate(unit);
      if (outcome.valid !== true) {
        throw callerError(`memory unit rejected by schema: ${JSON.stringify(outcome.errors?.[0] ?? null)}`);
      }
      units.set(unit.id, clone(unit));
    },
    async delete(id) {
      units.delete(id);
    },
    async list() {
      return [...units.values()].map((u) => clone(u));
    },
  };
}
