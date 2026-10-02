import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, planMigration, migrate, migrationStatus } from '@jarenjs/db';
import { openTangleDb, TANGLE_DB_MODEL, pickDriver } from '@tangleai/store';

const collections = ['mas_node_attempts', 'mas_messages', 'mas_state_revisions', 'mas_interactions', 'mas_trace_artifacts'] as const;
const selectedRun = 'selected:/é';
const query = {
  $for: { r: '$[*]' },
  $where: { $and: [{ $eq: ['$r.runId', { $const: selectedRun }] }] },
  $orderby: '$r.id', $return: '$r',
};
interface Plan { mode: string; indexes: string[]; scanNarrative: string }
// The prior physical shape is independent data: key plus JSON document,
// required string id/runId, and no generated column or secondary index.
const legacyTraceCollection = {
  schema: { type: 'object', required: ['id', 'runId'], properties: {
    id: { type: 'string', minLength: 1 }, runId: { type: 'string', minLength: 1 },
  } }, key: '/id',
};
const legacyModel = { ...TANGLE_DB_MODEL, collections: { ...TANGLE_DB_MODEL.collections,
  ...Object.fromEntries(collections.map(name => [name, legacyTraceCollection])),
} };
const rows = [
  { id: 'z', runId: selectedRun, payload: { text: 'retained', seq: 2 } },
  { id: 'a', runId: selectedRun, payload: { text: 'first', seq: 1 } },
  { id: 'b', runId: selectedRun + ':child', payload: { text: 'different run', seq: 1 } },
];
const allRows = { $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r' };

it('every MAS trace collection seeks the exact run and preserves deterministic record order', async () => {
  const db = await openTangleDb();
  try {
    for (const name of collections) {
      const collection = db.collection(name);
      for (const row of rows) await collection.put(row);
      const plan = await collection.explain(query) as Plan;
      assert.equal(plan.mode, 'native');
      assert.ok(plan.indexes.includes(name + '_by_run'));
      assert.ok(plan.scanNarrative.includes('SEARCH ' + name + ' USING INDEX ' + name + '_by_run'));
      assert.deepEqual(await collection.execute(query), [rows[1], rows[0]]);
    }
  } finally { await db.close(); }
});

it('the native model migration preserves prior trace records and queued jobs through reopen and zero-effect replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mas-trace-index-'));
  const path = join(directory, 'trace.sqlite'), driver = pickDriver();
  let db = await openStore(legacyModel, { driver, path, jobs: { now: () => 1000, random: () => 0.5 } });
  let open = true;
  try {
    for (const name of collections) {
      for (const row of rows) await db.collection(name).put(row);
      const plan = await db.collection(name).explain(query) as Plan;
      assert.ok(plan.scanNarrative.includes('SCAN ' + name));
    }
    await db.collection('settings').put({ key: 'unrelated', value: { keep: true } });
    await db.jobs!.enqueue('retained-job', { original: true }, { id: 'retained-job' });
    const jobsBefore = await db.jobs!.counts(), jobBefore = await db.jobs!.get('retained-job');
    await db.close(); open = false;
    await assert.rejects(openTangleDb({ driver, path }), (error: unknown) => (error as { code?: string }).code === 'JD0002');
    const planned = planMigration(legacyModel, TANGLE_DB_MODEL, { dialect: driver.dialect, id: 'mas-trace-run-indexes' }) as {
      migration: unknown; report: { destructive: boolean; drafts: unknown[]; schemaChanged: unknown[] };
    };
    assert.equal(planned.report.destructive, false);
    assert.deepEqual(planned.report.drafts, []);
    assert.deepEqual(planned.report.schemaChanged, []);
    const options = { baseline: legacyModel, model: TANGLE_DB_MODEL, shadowDriver: driver };
    const preview = await migrate({ driver, path }, [planned.migration], { ...options, dryRun: true });
    assert.ok('dryRun' in preview && preview.shadowValidated);
    // Planning and a refused incompatible open have not changed source records.
    db = await openStore(legacyModel, { driver, path, jobs: true }); open = true;
    for (const name of collections) {
      assert.deepEqual(await db.collection(name).execute(query), [rows[1], rows[0]]);
      assert.deepEqual(await db.collection(name).execute(allRows), [rows[1], rows[2], rows[0]]);
    }
    assert.deepEqual(await db.jobs!.get('retained-job'), jobBefore);
    await db.close(); open = false;
    const applied = await migrate({ driver, path }, [planned.migration], options);
    assert.ok('applied' in applied); assert.deepEqual(applied.applied, ['mas-trace-run-indexes']);
    const replay = await migrate({ driver, path }, [planned.migration], options);
    assert.ok('applied' in replay); assert.deepEqual(replay.applied, []);
    assert.equal((await migrationStatus({ driver, path }, [planned.migration], options)).upToDate, true);
    db = await openTangleDb({ driver, path, jobs: true }); open = true;
    for (const name of collections) {
      assert.deepEqual(await db.collection(name).execute(query), [rows[1], rows[0]]);
      assert.deepEqual(await db.collection(name).execute(allRows), [rows[1], rows[2], rows[0]]);
      const plan = await db.collection(name).explain(query) as Plan;
      assert.ok(plan.scanNarrative.includes('SEARCH ' + name + ' USING INDEX ' + name + '_by_run'));
    }
    assert.deepEqual(await db.collection('settings').get('unrelated'), { key: 'unrelated', value: { keep: true } });
    assert.deepEqual(await db.jobs!.get('retained-job'), jobBefore);
    assert.deepEqual(await db.jobs!.counts(), jobsBefore);
    assert.equal((await db.integrityCheck()).ok, true);
  } finally {
    if (open) await db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
