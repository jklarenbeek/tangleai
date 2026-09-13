/** Runtime consumer: a native snapshot retains outcome audit and replay state. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import { runOutcomeExample } from '../../examples/outcomes.ts';

// The test parent owns filesystem teardown after this runtime exits.
const dir = process.argv[2];
assert.ok(dir, 'backup fixture requires its parent-owned temporary directory');
{
  const source = await openTangleDb({ path: join(dir, 'source.db'), walAutocheckpoint: 0 });
  let first;
  const target = join(dir, 'backup.db');
  try {
    first = await runOutcomeExample(createOutcomeStore(source));
    assert.equal(source.capabilities.maintenance.backup, true);
    const copied = await source.backupTo(target, { checkpoint: false });
    assert.ok(copied.pages > 0);
    // Writes after the snapshot must not leak into the backed-up audit state.
    await source.collection('settings').put({ key: 'after-snapshot', value: true });
    await assert.rejects(() => source.backupTo(target, { signal: AbortSignal.abort() }));
  } finally { await source.close(); }
  const restored = await openTangleDb({ path: target });
  try {
    assert.equal((await restored.integrityCheck()).ok, true);
    assert.equal(await restored.collection('settings').get('after-snapshot'), undefined);
    const replay = await runOutcomeExample(createOutcomeStore(restored));
    assert.deepEqual(replay.ids, first.ids);
    assert.equal(replay.writes, 0);
    assert.equal(replay.sourceReads, 0);
    console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', domains: replay.domains, writes: replay.writes, sourceReads: replay.sourceReads }));
  } finally { await restored.close(); }
}
