/** Keyless Node process host: ordinary Tangle stores, explicit owner settlement. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nodeProcessDriver } from '@jarenjs/db/node-process';
import { openTangleDb, createOutcomeStore, type TangleDb } from '@tangleai/store';
import { runOutcomeExample } from './outcomes.ts';

export async function runSupervisedStoreExample(path: string) {
  // Share this driver across this host's opens: quarantine retains its credit.
  const driver = nodeProcessDriver({ maxOwners: 1, timeoutMs: 30_000 });
  async function visit() {
    const owner = await driver.open(path, { timeout: 50, queueTimeout: 1_000 });
    let db: TangleDb | undefined;
    const [operation] = await Promise.allSettled([(async () => {
      db = await openTangleDb({ path, driver: { ...driver, open: async () => owner } });
      const store = createOutcomeStore(db);
      assert.equal(db.capabilities.process, true);
      return owner.supervise(() => runOutcomeExample(store));
    })()]);
    const [cleanup] = await Promise.allSettled([db ? db.close() : owner.close()]);
    const settlement = await owner.settled();
    // An expired response or rejected close is not an OS exit observation.
    assert.equal(settlement.safeToReplace, true);
    if (operation.status === 'rejected') {
      if (cleanup.status === 'rejected') throw new AggregateError([operation.reason, cleanup.reason], 'Operation and owner cleanup failed');
      throw operation.reason;
    }
    if (cleanup.status === 'rejected') throw cleanup.reason;
    return operation.value;
  }
  const first = await visit();
  const replay = await visit();
  assert.deepEqual(replay.ids, first.ids);
  assert.equal(replay.writes, 0);
  assert.equal(replay.sourceReads, 0);
  assert.equal(driver.metrics().owners, 0);
  return { first, replay, owners: driver.metrics().owners };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--db')) throw Error('Usage: node examples/supervised-store.ts [--db path]');
  const temporary = args.length ? undefined : await mkdtemp(join(tmpdir(), 'tangle-supervised-'));
  try { console.log(JSON.stringify(await runSupervisedStoreExample(args[1] ?? join(temporary!, 'outcomes.sqlite')), null, 2)); }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
