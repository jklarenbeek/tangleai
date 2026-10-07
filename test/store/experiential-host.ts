/** The caller owns the directory until both SQLite handles have closed. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createExperientialStoreAdapter, EXPERIENTIAL_TABLES, type ExperientialMemoryState, type ExperientialTable, type ExperientialTables } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbPersistence } from '@tangleai/store';
import { EXPERIENTIAL_FIXTURE_TIME, type ExperientialProbeHost } from '../experiential/store-fixtures.ts';

export function experientialSqliteProbeFactory(directory: string): () => Promise<ExperientialProbeHost> {
  let instance = 0;
  return async function createSqliteProbe(): Promise<ExperientialProbeHost> {
    const path = join(directory, 'experiential-' + instance++ + '.sqlite');
    let db = await openTangleDb({ path }), host: ExperientialProbeHost;
    const applyProbe = (step: string) => { if (host?.failAt === step && --host.failOccurrence === 0) throw new Error('Injected transaction failure.'); };
    const options = { now: () => EXPERIENTIAL_FIXTURE_TIME };
    let persistence = createExperientialDbPersistence(db, { applyProbe });
    host = {
      persistence, store: createExperientialStoreAdapter(persistence, options), peer: createExperientialStoreAdapter(persistence, options),
      failAt: null, failOccurrence: 1,
      async state() {
        // Read the native rows directly so fault injection applies only to the
        // operation being measured, never to the observation of its rollback.
        const state: Partial<ExperientialMemoryState> = {};
        for (const table of EXPERIENTIAL_TABLES) {
          const rows: ExperientialTables[ExperientialTable][] = [];
          for await (const row of db.collection('experiential_' + table).query<ExperientialTables[ExperientialTable]>({
            $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r.payload',
          })) rows.push(row);
          Object.assign(state, { [table]: rows });
        }
        return state as ExperientialMemoryState;
      },
      async reopen() {
        assert.equal((await db.integrityCheck()).ok, true); await db.close(); db = await openTangleDb({ path });
        persistence = createExperientialDbPersistence(db, { applyProbe }); host.persistence = persistence;
        host.store = createExperientialStoreAdapter(persistence, options); host.peer = createExperientialStoreAdapter(persistence, options);
      },
      close: () => db.close(),
    };
    return host;
  };
}
