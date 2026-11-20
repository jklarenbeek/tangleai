/**
 * The Collections application's SQLite source, built as its own script
 * (`os-sqlite.js`) and fetched only when a person picks that source, so the
 * desktop's bundle carries no SQLite: the official initializer finds
 * sqlite3.wasm beside this script, the rows go into an in-memory database,
 * and a resident range provider (a complete, bounded snapshot) serves them.
 */
import { wasmDriver, sqlite3Handle } from '@jarenjs/db/wasm';
import { open, createDbRangeProvider } from '@jarenjs/linq/db';
import { initializeSqlite } from '../demos/playground/sqlite.ts';

export async function openSqliteRows(rows: readonly { id: string, n: number, rank: number }[]): Promise<{ provider: any, close: () => Promise<void> }> {
  const sqlite = await initializeSqlite({ locateFile: (name: string) => new URL(name, import.meta.url).href, print: () => {}, printErr: () => {} });
  const client: any = await open({ $model: '0.1', entities: { Row: { schema: { type: 'object', properties: {
    id: { type: 'string', 'x-entity': { key: true } }, n: { type: 'integer' }, rank: { type: 'integer' } } } } } } as any,
  { driver: wasmDriver(sqlite3Handle(sqlite as any)), capture: true } as any);
  try {
    for (const row of rows) await client.entities.Row.create(row);
    const provider = await createDbRangeProvider(client.store, 'Row', { orderBy: '$it.n' }, { keys: ['id'], resident: true, maxRows: rows.length });
    return { provider, close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}
