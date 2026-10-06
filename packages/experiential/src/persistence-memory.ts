/** One native scheduler serializes copy-on-write transactions. */
import { cloneJson } from '@jarenjs/core/object';
import { createScheduler } from '@jarenjs/core/schedule';
import { EXPERIENTIAL_TABLES, type ExperientialTables, type ExperientialTable, type ExperientialPersistence, type ExperientialTransaction } from './store-types.ts';

export type ExperientialMemoryState = { [K in ExperientialTable]: ExperientialTables[K][] };
export interface ExperientialMemoryOptions { state?: Partial<ExperientialMemoryState>; applyProbe?: (step: string) => void }
export interface ExperientialMemoryPersistence extends ExperientialPersistence {
  exportState(): ExperientialMemoryState;
  close(): Promise<void>;
}
const keyOf = (table: ExperientialTable, id: string) => table + ':' + id;

export function createExperientialMemoryPersistence(options: ExperientialMemoryOptions = {}): ExperientialMemoryPersistence {
  let rows = new Map<string, ExperientialTables[ExperientialTable]>();
  for (const table of EXPERIENTIAL_TABLES) for (const row of options.state?.[table] ?? []) {
    const key = keyOf(table, row.id);
    if (rows.has(key)) throw new TypeError('Duplicate record in the initial experiential state.');
    rows.set(key, cloneJson(row));
  }
  const scheduler = createScheduler({ concurrency: 1, maxQueue: 128 });
  return {
    exportState: () => Object.fromEntries(EXPERIENTIAL_TABLES.map(table => [table,
      [...rows.entries()].filter(([key]) => key.startsWith(table + ':')).map(([, value]) => cloneJson(value)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ])) as ExperientialMemoryState,
    close: () => scheduler.close(),
    transaction<T>(task: (view: ExperientialTransaction) => Promise<T>): Promise<T> {
      return scheduler.run(async () => {
        const staged = new Map(rows);
        let active = true;
        const guard = (table: ExperientialTable) => {
          if (!active) throw new TypeError('The experiential transaction has ended.');
          if (!EXPERIENTIAL_TABLES.includes(table)) throw new TypeError('Unknown experiential table.');
        };
        const view: ExperientialTransaction = {
          async get(table, id) { guard(table); return cloneJson(staged.get(keyOf(table, id))) as never; },
          async list(table, scope) {
            guard(table);
            return [...staged.entries()].filter(([key, row]) => key.startsWith(table + ':') && row.scope === scope)
              .map(([, row]) => cloneJson(row)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) as never;
          },
          async put(table, value) { guard(table); staged.set(keyOf(table, value.id), cloneJson(value)); options.applyProbe?.('put:experiential_' + table); },
        };
        try {
          const result = await task(view);
          options.applyProbe?.('commit');
          rows = staged;
          return result;
        } finally { active = false; }
      });
    },
  };
}
