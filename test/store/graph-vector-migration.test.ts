import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createModelShape } from '@jarenjs/db';
import { TANGLE_DB_MODEL, createTangleDbModel, declareGraphVectors, planGraphVectorMigration, applyGraphVectorMigrations,
  verifyVectorPlan, pickDriver, openTangleDb, GRAPH_VECTOR_STATE_KEY } from '@tangleai/store';
import type { MigrationConnection } from '../../examples/physical-migration.ts';

const identity = { model: 'hash-trigram-64', dims: 64 };
const declaration = declareGraphVectors(identity);
it('optional graph declarations preserve the default model and touch only both canonical nested embeddings', () => {
  const before = structuredClone(TANGLE_DB_MODEL);
  assert.strictEqual(createTangleDbModel(), TANGLE_DB_MODEL);
  const target = createTangleDbModel({ graphVectors: declaration });
  assert.deepEqual(TANGLE_DB_MODEL, before);
  for (const name of Object.keys(before.collections) as Array<keyof typeof before.collections>) {
    if (name === 'lightrag_entities' || name === 'lightrag_relations') {
      assert.notDeepEqual(target.collections[name], before.collections[name]);
      assert.equal(target.collections[name].indexes.at(-1)!.path, '$.payload.embedding');
    } else assert.deepEqual(target.collections[name], before.collections[name]);
  }
  assert.throws(() => declareGraphVectors({ model: '', dims: 64 }), { code: 'TVEC1001' });
  assert.throws(() => declareGraphVectors({ model: 'unsettled', dims: 0 }), { code: 'TVEC1001' });
  assert.throws(() => createTangleDbModel({ graphVectors: { ...declaration, widths: [128] } }), { code: 'TVEC1001' });
  assert.throws(() => verifyVectorPlan({ mode: 'scan' }, 64), { code: 'TVEC1002' });
});

it('removing a width fences retained authority, active rows and pending stages before native DDL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-drop-')), path = join(directory, 'graph.db'), driver = pickDriver();
  const target = { model: 'hash-trigram-128', dims: 128 }, both = declareGraphVectors(target, [identity]), after = declareGraphVectors(target);
  const state = { revision: 3, active: target, retained: [] };
  const raw = { id: 'retained', sourceId: null, versionId: null, projectionId: null, normalizedName: null,
    status: 'inactive', sourceEntityId: null, targetEntityId: null, payload: { embedding: [1, ...Array(63).fill(0)], embeddedBy: identity } };
  const add = planGraphVectorMigration(null, both, 'graph-both');
  const drop = planGraphVectorMigration(both, after, 'graph-drop', { dropState: state });
  type Connection = Omit<MigrationConnection, 'prepare'> & { prepare(sql: string): ReturnType<MigrationConnection['prepare']> & { run(params: readonly unknown[]): unknown } };
  const shadowFixture = async (unknown: unknown) => {
    const connection = unknown as Connection;
    await createModelShape(connection, TANGLE_DB_MODEL);
    connection.prepare('INSERT INTO settings (key,doc) VALUES (?,jsonb(?))').run([GRAPH_VECTOR_STATE_KEY,
      JSON.stringify({ key: GRAPH_VECTOR_STATE_KEY, value: state })]);
  };
  const options = { baseline: null, driver, shadowFixture };
  try {
    let db = await openTangleDb({ path, driver });
    await db.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: state });
    for (const name of ['lightrag_entities', 'lightrag_relations']) await db.collection(name).put(raw);
    await db.close();
    await applyGraphVectorMigrations({ driver, path }, [add], { baseline: null, driver });
    db = await openTangleDb({ path, driver, graphVectors: both });
    await db.collection('settings').put({ key: 'pending-stage', value: { document: 'graph-vector-stage-reservation', status: 'pending', widths: [64, 128] } });
    await db.close();
    await assert.rejects(applyGraphVectorMigrations({ driver, path }, [add, drop], options), { code: 'TVEC1004' });
    db = await openTangleDb({ path, driver, graphVectors: both });
    await db.collection('settings').delete('pending-stage');
    await db.collection('lightrag_entities').put({ ...raw, status: 'active' });
    await db.close();
    await assert.rejects(applyGraphVectorMigrations({ driver, path }, [add, drop], options), { code: 'TVEC1004' });
    db = await openTangleDb({ path, driver, graphVectors: both });
    await db.collection('lightrag_entities').put(raw);
    await db.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: { ...state, revision: 4 } });
    await db.close();
    await assert.rejects(applyGraphVectorMigrations({ driver, path }, [add, drop], options), { code: 'TVEC1004' });
    db = await openTangleDb({ path, driver, graphVectors: both });
    await db.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: state });
    await db.close();
    const applied = await applyGraphVectorMigrations({ driver, path }, [add, drop], options);
    assert.ok('applied' in applied.result); assert.deepEqual(applied.result.applied, ['graph-drop']);
    const replay = await applyGraphVectorMigrations({ driver, path }, [add, drop], options);
    assert.ok('applied' in replay.result); assert.deepEqual(replay.result.applied, []);
    const connection = await driver.open(path) as MigrationConnection;
    try {
      for (const name of ['lightrag_entities', 'lightrag_relations']) {
        const columns = connection.prepare('PRAGMA table_xinfo(' + name + ')').all([]).map(row => row.name);
        assert.ok(columns.includes('gx_payload_embedding_v128')); assert.ok(!columns.includes('gx_payload_embedding_v64'));
      }
    } finally { await connection.close(); }
    db = await openTangleDb({ path, driver, graphVectors: after });
    try { for (const name of ['lightrag_entities', 'lightrag_relations']) assert.deepEqual(await db.collection(name).get(raw.id), raw); }
    finally { await db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('native graph backfill preserves raw fixture bytes, survives reopen and replays no migration steps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-migration-')), path = join(directory, 'graph.db'), driver = pickDriver();
  const vector = [1, ...Array(63).fill(0)];
  // Raw storage fixtures qualify only physical columns; domain write and
  // retrieval acceptance is exercised by the joint corpus tests.
  const raw = { id: 'fixture', sourceId: null, versionId: null, projectionId: null, normalizedName: null,
    status: 'active', sourceEntityId: null, targetEntityId: null, payload: { id: 'fixture', embedding: vector, embeddedBy: identity } };
  try {
    const db = await openTangleDb({ path, driver });
    try { for (const name of ['lightrag_entities', 'lightrag_relations']) await db.collection(name).put(raw); }
    finally { await db.close(); }
    const plan = planGraphVectorMigration(null, declaration, 'graph-64');
    assert.equal(plan.migration.steps.filter(step => step.kind === 'derive').length, 2);
    const connection = await driver.open(path) as MigrationConnection;
    try {
      // Pinned native dry-run rendering mistakes derive for an assertion after
      // its shadow succeeds. Preserve the refusal; the actual migration still
      // uses native shadow execution and final-state validation below.
      await assert.rejects(applyGraphVectorMigrations({ connection }, [plan], { baseline: null, driver, dryRun: true }),
        (error: unknown) => error instanceof Error && error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'JD0023');
      assert.equal(connection.prepare("SELECT name FROM sqlite_schema WHERE name='_jaren_migrations'").get([]), undefined);
      const applied = await applyGraphVectorMigrations({ connection }, [plan], { baseline: null, driver });
      assert.ok('applied' in applied.result); assert.deepEqual(applied.result.applied, ['graph-64']); assert.equal(applied.status!.upToDate, true);
      for (const name of ['lightrag_entities', 'lightrag_relations'])
        assert.equal(connection.prepare('SELECT length(gx_payload_embedding_v64) bytes FROM ' + name).get([])!.bytes, 256);
    } finally { await connection.close(); }
    const replay = await applyGraphVectorMigrations({ driver, path }, [plan], { baseline: null, driver });
    assert.ok('applied' in replay.result); assert.deepEqual(replay.result.applied, []); assert.equal(replay.status!.upToDate, true);
    await assert.rejects(openTangleDb({ path, driver }), { code: 'JD0002' });
    const opened = await openTangleDb({ path, driver, graphVectors: declaration });
    try {
      for (const name of ['lightrag_entities', 'lightrag_relations']) {
        assert.deepEqual(await opened.collection(name).get('fixture'), raw);
        const query = { $subsequence: [{ $for: { r: '$[*]' }, $orderby: [{ $key: { $similarity: ['$r.payload.embedding', '$q'] }, $dir: 'desc', $empty: 'least' }, '$r.id'], $return: '$r' }, 0, 1] };
        assert.equal(verifyVectorPlan(await opened.collection(name).explain(query, { externals: { q: vector } }), 64).dims, 64);
      }
    } finally { await opened.close(); }
    const both = declareGraphVectors({ model: 'hash-trigram-128', dims: 128 }, [identity]);
    const second = planGraphVectorMigration(declaration, both, 'graph-128');
    assert.equal(second.migration.steps.filter(step => step.kind === 'derive').length, 2);
    const widened = await applyGraphVectorMigrations({ driver, path }, [plan, second], { baseline: null, driver });
    assert.ok('applied' in widened.result); assert.deepEqual(widened.result.applied, ['graph-128']);
    const only128 = declareGraphVectors(both.active);
    assert.throws(() => planGraphVectorMigration(both, only128, 'graph-drop64'), { code: 'TVEC1003' });
    const damaged = structuredClone(second); damaged.migration.steps.pop();
    await assert.rejects(applyGraphVectorMigrations({ driver, path }, [plan, damaged], { baseline: null, driver }), { code: 'TVEC1003' });
    const drift = await driver.open(path) as MigrationConnection;
    try { drift.exec('ALTER TABLE lightrag_entities DROP COLUMN gx_payload_embedding_v64'); }
    finally { await drift.close(); }
    await assert.rejects(applyGraphVectorMigrations({ driver, path }, [plan, second], { baseline: null, driver }), { code: 'TVEC1004' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('invalid retained embedding bytes refuse native backfill and roll back its physical changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-invalid-')), path = join(directory, 'graph.db'), driver = pickDriver();
  const raw = { id: 'invalid', sourceId: null, versionId: null, projectionId: null, normalizedName: null,
    status: 'active', sourceEntityId: null, targetEntityId: null, payload: { embedding: 'invalid persisted fixture', embeddedBy: identity } };
  try {
    const db = await openTangleDb({ path, driver }); await db.collection('lightrag_entities').put(raw); await db.close();
    await assert.rejects(applyGraphVectorMigrations({ driver, path }, [planGraphVectorMigration(null, declaration, 'invalid-backfill')],
      { baseline: null, driver }), { code: 'TVEC1004' });
    const connection = await driver.open(path) as MigrationConnection;
    try {
      assert.ok(!connection.prepare('PRAGMA table_xinfo(lightrag_entities)').all([]).some(column => column.name === 'gx_payload_embedding_v64'));
      const history = connection.prepare("SELECT name FROM sqlite_schema WHERE name='_jaren_migrations'").get([]);
      if (history) assert.equal(connection.prepare('SELECT count(*) n FROM _jaren_migrations').get([])!.n, 0);
    } finally { await connection.close(); }
    const reopened = await openTangleDb({ path, driver });
    try { assert.deepEqual(await reopened.collection('lightrag_entities').get(raw.id), raw); }
    finally { await reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('saved graph migrations and execution options are fixed before an asynchronous connection opens', async () => {
  for (const mutation of ['migration-id', 'migration-steps', 'dry-run', 'target-path'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-migration-snapshot-')), path = join(directory, 'graph.db'), driver = pickDriver();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const deferredDriver = { ...driver, open: async (...args: Parameters<typeof driver.open>) => { await ready; return driver.open(...args); } };
    const raw = { id: 'preserved', sourceId: null, versionId: null, projectionId: null, normalizedName: null,
      status: 'active', sourceEntityId: null, targetEntityId: null, payload: { embedding: [1, ...Array(63).fill(0)], embeddedBy: identity } };
    try {
      const db = await openTangleDb({ path, driver });
      try { await db.collection('lightrag_entities').put(raw); } finally { await db.close(); }
      const plan = structuredClone(planGraphVectorMigration(null, declaration, 'captured-graph-64'));
      const options = { baseline: null, driver, dryRun: false };
      const target = { driver: deferredDriver, path };
      const pending = applyGraphVectorMigrations(target, [plan], options);
      if (mutation === 'migration-id') plan.migration.id = 'unreviewed-migration';
      else if (mutation === 'migration-steps') plan.migration.steps.push({ kind: 'sql', sql: 'DELETE FROM lightrag_entities' });
      else if (mutation === 'dry-run') options.dryRun = true;
      else target.path = join(directory, 'unreviewed.db');
      release();
      const applied = await pending;
      assert.ok('applied' in applied.result); assert.deepEqual(applied.result.applied, ['captured-graph-64']);
      assert.equal(applied.status?.upToDate, true);
      const reopened = await openTangleDb({ path, driver, graphVectors: declaration });
      try { assert.deepEqual(await reopened.collection('lightrag_entities').get(raw.id), raw); }
      finally { await reopened.close(); }
      const original = planGraphVectorMigration(null, declaration, 'captured-graph-64');
      const replay = await applyGraphVectorMigrations({ driver, path }, [original], { baseline: null, driver });
      assert.ok('applied' in replay.result); assert.deepEqual(replay.result.applied, []);
    } finally { release(); await rm(directory, { recursive: true, force: true }); }
  }
});
