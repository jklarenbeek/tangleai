/** One actual SQLite runtime executes all independent cases; parent captures only normalized outcomes. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import { TEMPORAL_FIXTURES } from '../../test/fixtures/temporal.ts';
import { runTemporalFixture } from '../lib/temporal-runtime.ts';
const rows = [];
for (const { expected: _oracle, ...scenario } of TEMPORAL_FIXTURES) {
  const directory = scenario.id === 'T36' ? await mkdtemp(join(tmpdir(), 'temporal-fixture-')) : null;
  const path = directory ? join(directory, 'fixture.db') : ':memory:';
  let db = await openTangleDb({ path });
  try { rows.push({ id: scenario.id, result: await runTemporalFixture(scenario, createTemporalDbStore(db), async () => { await db.close(); db = await openTangleDb({ path }); return createTemporalDbStore(db); }) }); }
  finally { await db.close(); if (directory) await rm(directory, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ backend: process.versions.bun ? 'bun-sqlite' : 'node-sqlite', rows }));
