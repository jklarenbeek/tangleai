/** Count successful native statement rows, separately from logical graph reads. */
import type { Driver } from '@jarenjs/db';
import { adaptNodeDatabase, nodeDriver, type NodeOpenOptions } from '@jarenjs/db/node';
import { cloneJson } from '@jarenjs/core/object';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import type { LightRagStore } from '@tangleai/lightrag';
import type { DocumentCorpusStore } from '@tangleai/documents';

import type { VectorSqlCounts } from './vector-scale.types.ts';
export type { VectorSqlCounts } from './vector-scale.types.ts';
const empty = (): VectorSqlCounts => ({ statements: 0, returnedRows: 0, writes: 0, failures: 0, elapsedMs: 0 });
export function createVectorSqlObserver(timer: () => number = () => performance.now()) {
  let tables: Record<string, VectorSqlCounts> = {};
  function observe(statement: StatementSync, sql: string): StatementSync {
    const names = [...new Set([...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+"(lightrag_[a-z_]+|document_[a-z_]+|sources|settings|_jaren_migrations)"/gi)].map(m => m[1]))];
    const counts = () => names.map(name => tables[name] ??= empty());
    return new Proxy(statement, { get(target, key) {
      if (key === 'iterate') return function* (...params: SQLInputValue[]) {
        const rows = counts(); for (const row of rows) row.statements++;
        const iterator = target.iterate(...params);
        try {
          while (true) {
            const started = timer(); let next: IteratorResult<Record<string, unknown>>;
            try { next = iterator.next(); }
            finally { const elapsed = timer() - started; for (const row of rows) row.elapsedMs += elapsed; }
            if (next.done) break;
            for (const row of rows) row.returnedRows++;
            yield next.value;
          }
        }
        catch (cause) { for (const row of rows) row.failures++; throw cause; }
        finally { iterator.return?.(); }
      };
      if (key === 'all' || key === 'get' || key === 'run') return (...params: SQLInputValue[]) => {
        const started = timer(), rows = counts(); for (const row of rows) row.statements++;
        try {
          if (key === 'run') {
            const result = target.run(...params); for (const row of rows) row.writes += Number(result.changes); return result;
          }
          const result = key === 'all' ? target.all(...params) : target.get(...params);
          for (const row of rows) row.returnedRows += Array.isArray(result) ? result.length : result === undefined ? 0 : 1;
          return result;
        } catch (cause) { for (const row of rows) row.failures++; throw cause; }
        finally { const elapsed = timer() - started; for (const row of rows) row.elapsedMs += elapsed; }
      };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  const native = nodeDriver();
  const driver: Driver = { ...native, async open(path, rawOptions) {
    const options = rawOptions as NodeOpenOptions | undefined, { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path, { timeout: options?.timeout, readOnly: options?.readOnly });
    // Observe the raw statement boundary before native transaction scopes are
    // constructed; wrapping only the public connection misses their reads.
    const wrapped = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => observe(target.prepare(sql), sql);
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    return adaptNodeDatabase(wrapped, { queueTimeout: options?.queueTimeout });
  } };
  return { driver, snapshot: () => cloneJson(tables), reset: () => { tables = {}; } };
}

/** Awaited store reads include decoding and projection, beyond raw SQLite time. */
export function observeVectorReads(graph: LightRagStore, documents: DocumentCorpusStore, timer: () => number) {
  let fetchMs = 0, rankingFetchMs = 0, projectionReads = 0;
  function wrap<T extends object>(store: T, isGraph: boolean): T {
    return new Proxy(store, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function' || typeof key !== 'string' || !/^(get|list|rankRows)/.test(key)) return value;
      return async (...args: unknown[]) => {
        const ranking = isGraph && (key === 'rankRows' || (key === 'listEntities' || key === 'listRelations') && args[0] === undefined
          || key === 'listProjections' && projectionReads++ === 0);
        const start = timer();
        try { return await value.apply(target, args); }
        finally { const elapsed = timer() - start; fetchMs += elapsed; if (ranking) rankingFetchMs += elapsed; }
      };
    } });
  }
  return { graph: wrap(graph, true), documents: wrap(documents, false),
    snapshot: () => ({ fetchMs, rankingFetchMs }), reset: () => { fetchMs = 0; rankingFetchMs = 0; projectionReads = 0; } };
}
