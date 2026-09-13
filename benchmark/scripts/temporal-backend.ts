/** One actual SQLite runtime executes all independent cases; parent captures only normalized outcomes. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import { TEMPORAL_FIXTURES } from '../../test/fixtures/temporal.ts';
import { runTemporalFixture } from '../lib/temporal-runtime.ts';
const rows = [];
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
assert.ok(directory, 'temporal backend requires parent-owned scratch');
for (const { expected: _oracle, ...scenario } of TEMPORAL_FIXTURES) {
  const path = scenario.id === 'T36' ? join(directory, 'fixture.db') : ':memory:';
  let db = await openTangleDb({ path });
  try { rows.push({ id: scenario.id, result: await runTemporalFixture(scenario, createTemporalDbStore(db), async () => { await db.close(); db = await openTangleDb({ path }); return createTemporalDbStore(db); }) }); }
  finally { await db.close(); }
}
console.log(JSON.stringify({ backend: process.versions.bun ? 'bun-sqlite' : 'node-sqlite', rows }));
