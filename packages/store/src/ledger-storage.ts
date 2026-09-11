/** Atomic AI ledger storage over the existing key/value collection. The suite
 * owns ledger staging, conflict retries and retention; this adapter publishes
 * each synchronous mutation through the database's transaction owner. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import type { MasLedgerStorage } from '@tangleai/mas';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

interface Slot { key: string; value: unknown }

export function createDbLedgerStorage(db: TangleDb, namespace: string): MasLedgerStorage {
  if (typeof namespace !== 'string' || namespace.length === 0) throw new TypeError('ledger storage needs a namespace');
  const prefix = `ai-ledger/${JSON.stringify(namespace)}/`;
  const slots = db.collection<Slot>('settings');
  const query = (part: string) => ({
    $for: { s: '$[*]' }, $where: { '$starts-with': ['$s.key', part] },
    $orderby: ['$s.key'], $return: '$s',
  });
  return {
    get: async (key) => (await slots.get(prefix + key))?.value,
    set: async (key, value) => { await slots.put({ key: prefix + key, value: cloneJson(value) }); },
    delete: async (key) => { await slots.delete(prefix + key); },
    keys: async (part = '') => asRows(await slots.execute<Slot>(query(prefix + part))).map((slot) => slot.key.slice(prefix.length)),
    mutate: async (scope, transform) => db.transaction(async (tx) => {
      const handle = tx.collection<Slot>('settings');
      const prefixes = typeof scope === 'string' ? [scope] : scope.prefixes ?? [];
      const keys = typeof scope === 'string' ? [] : scope.keys ?? [];
      const matches = (key: string) => keys.includes(key) || prefixes.some((part) => key.startsWith(part));
      const rows = asRows(await handle.execute<Slot>(query(prefix))).filter((slot) => matches(slot.key.slice(prefix.length)));
      const current = Object.fromEntries(rows.map((slot) => [slot.key.slice(prefix.length), slot.value]));
      const outcome = transform(cloneJson(current));
      if (!outcome || typeof (outcome as { then?: unknown }).then === 'function') throw new TypeError('ledger mutations must be synchronous');
      if (outcome.next !== undefined) {
        const next = cloneJson(outcome.next);
        if (next === null || typeof next !== 'object' || Array.isArray(next) || Object.keys(next).some((key) => !matches(key))) {
          throw new TypeError('ledger mutation escaped its scope');
        }
        for (const key of Object.keys(current)) if (!Object.hasOwn(next, key)) await handle.delete(prefix + key);
        for (const [key, value] of Object.entries(next)) {
          if (!Object.hasOwn(current, key) || !equalsJson(current[key], value)) await handle.put({ key: prefix + key, value });
        }
      }
      return outcome.result;
    }, { mode: 'immediate' }),
  };
}
