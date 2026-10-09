import assert from 'node:assert/strict';
import { runVectorMigrationExample } from './vector-example.mjs';
assert.match(import.meta.resolve('@tangleai/store'), /\.js$/);
const directory = process.env.TANGLE_FIXTURE_DIRECTORY; assert.ok(directory);
const result = await runVectorMigrationExample(directory);
assert.deepEqual(result, { migrations: 3, replayedMigrations: 0, identitySwaps: 2, exactRollback: true,
  stageEmbeddingCalls: 3, rollbackEmbeddingCalls: 0, dryRunCause: 'JD0023', physicalRequests: 0 });
console.log('Installed native graph backfill, exact rank, complete identity swap, retained rollback, column disposal and replay passed.');
