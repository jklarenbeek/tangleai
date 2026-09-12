/** Child-runtime evidence entry; parent provides a disposable SQLite path. */
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import { loadOutcomeFixtures } from '../lib/outcome-fixtures.ts';
import { measureOutcomeReplay } from '../lib/outcome-runtime.ts';
const path = process.argv[2]; if (!path) throw Error('SQLite path required');
const saved = globalThis.fetch; globalThis.fetch = async () => { throw Error('Network forbidden'); };
const db = await openTangleDb({ path });
try {
  const measured = await measureOutcomeReplay(await loadOutcomeFixtures(), { mode: 'checked-scripted', store: createOutcomeStore(db) });
  console.log(JSON.stringify({ binding: 'direct', store: 'sqlite', runtime: process.versions.bun ? 'bun' : 'node', requests: 0, contractRevision: null, trace: measured.trace }));
} finally { await db.close(); globalThis.fetch = saved; }
