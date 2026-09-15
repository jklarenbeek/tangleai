/**
 * Write a run-log fixture database in the released shape a desktop
 * without the frame stream produces: the `runs` collection with its
 * three terminal states, node records in `events`, and no frame
 * collection at all.
 *
 * The shape is derived from `TANGLE_DB_MODEL` rather than copied, so
 * the fixture stays a real database of the current model minus exactly
 * the two things a store that streams frames adds — which is what the
 * reopen path has to survive.
 *
 *   node scripts/desktop-run-fixture.ts test/fixtures/<name>.db
 *
 * Deliberately has no default path: a fixture is written once and read
 * forever, never silently refreshed.
 */

import { rmSync, existsSync } from 'node:fs';

import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { TANGLE_DB_MODEL } from '@tangleai/store';

const path = process.argv[2];
if (path === undefined || path === '') {
  console.error('usage: node scripts/desktop-run-fixture.ts <path>');
  process.exit(1);
}

const { run_frames: _frames, runs, ...collections } = TANGLE_DB_MODEL.collections as Record<string, any>;
const released = {
  ...TANGLE_DB_MODEL,
  collections: {
    ...collections,
    runs: { ...runs, schema: { ...runs.schema, properties: { ...runs.schema.properties, status: { enum: ['running', 'ok', 'error'] } } } },
  },
};

for (const suffix of ['', '-wal', '-shm']) if (existsSync(`${path}${suffix}`)) rmSync(`${path}${suffix}`);

const db = await openStore(released, { driver: nodeDriver(), path });
let tick = 0;
const now = (): string => new Date(Date.UTC(2026, 8, 14, 9, 0, 0) + (tick++) * 1000).toISOString();

const runId = 'r-1q60qef';
const startedAt = now();
const events = db.collection('events');
const nodes = ['observations', 'embed', 'novelty', 'contradiction', 'crystallize', 'report'];
for (const [index, node] of nodes.entries()) {
  await events.put({ id: `${runId}:${String(index + 1).padStart(4, '0')}`, runId, seq: index + 1, node, status: 'ok', ms: index + 1, at: now() });
}
await db.collection('runs').put({
  id: runId, kind: 'sync', startedAt, finishedAt: now(), status: 'ok',
  summary: { files: { scanned: 1, ingested: 1, skipped: 0 } },
  identityId: 'a'.repeat(64),
});
await db.close();
for (const suffix of ['-wal', '-shm']) if (existsSync(`${path}${suffix}`)) rmSync(`${path}${suffix}`);
console.log(`wrote ${path} (run ${runId}, ${nodes.length} events)`);
