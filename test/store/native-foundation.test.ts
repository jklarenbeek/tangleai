/** Host-owned native tables share the published database seam with Tangle records. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@jarenjs/db';
import { planTable, planSchemaChange, applySchemaChange, relational, sql } from '@jarenjs/db/relational';
import { TANGLE_DB_MODEL, pickDriver, createDbMemoryStore } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';

// Driver.open intentionally returns unknown. This fixture only opens the two
// published synchronous SQLite drivers and names the operations it observes.
interface NativeConnection {
  exec(text: string): unknown;
  prepare(text: string, options?: unknown): {
    all(params: readonly unknown[]): Record<string, unknown>[];
    get(params: readonly unknown[]): Record<string, unknown> | undefined;
  };
  transaction<T>(fn: () => T, options?: { mode: 'immediate' }): T;
  close(): unknown;
}
const model = { ...TANGLE_DB_MODEL, entities: { HostNote: {
  schema: { type: 'object', required: ['id', 'payload'], properties: {
    id: { type: 'integer', 'x-entity': { key: true } }, payload: { type: 'string' },
  } },
  physical: { table: 'host_notes', columns: {
    id: { name: 'id', codec: 'integer', null: 'reject' },
    payload: { name: 'payload', codec: 'text', null: 'reject' },
  } },
} } };
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;

async function open(path = ':memory:', create = true) {
  const driver = pickDriver(), connection = await driver.open(path) as NativeConnection;
  try {
    if (create) for (const definition of [
      { name: 'host_notes', primaryKey: ['id'], columns: [
        { name: 'id', type: 'INTEGER' as const }, { name: 'payload', type: 'TEXT' as const, nullable: false },
      ], indexes: [{ name: 'host_notes_payload', terms: [{ by: sql.column('payload') }] }] },
      { name: 'host_owners', primaryKey: ['id'], columns: [{ name: 'id', type: 'INTEGER' as const }] },
      { name: 'host_migrations', primaryKey: ['id'], columns: [{ name: 'id', type: 'INTEGER' as const }] },
    ]) for (const text of planTable(definition).createSql) connection.exec(text);
    const db = await openStore(model, { path, driver: { ...driver, open: () => connection } });
    return { db, connection, native: relational(connection) };
  } catch (error) { connection.close(); throw error; }
}

it('native additive migrations preserve Tangle evidence and commit their own receipt atomically across reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-native-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.db');
  const unit = createMemoryUnit({ text: 'Retain the original evidence.', evidence: 'native integration fixture', at: '2026-09-12T00:00:00Z' });
  const first = await open(path);
  try {
    await createDbMemoryStore(first.db.collection('memories')).put(unit);
    first.native.execute({ op: 'insert', table: 'host_notes', values: { id: 1, payload: ' { "answer": null } ' } });
    const plan = planSchemaChange(first.connection, { op: 'addColumn', table: 'host_notes',
      column: { name: 'revision', type: 'INTEGER', nullable: false, default: 1 } });
    const apply = () => {
      const result = applySchemaChange(first.connection, plan);
      first.native.execute({ op: 'insert', table: 'host_migrations', values: { id: 1 } });
      return result;
    };
    assert.throws(() => first.connection.transaction(() => { apply(); throw Error('rollback migration'); }), /rollback migration/);
    assert.equal(first.native.get({ from: 'host_migrations' }), undefined);
    assert.deepEqual({ ...first.native.get<Record<string, unknown>>({ from: 'host_notes' }) }, { id: 1, payload: ' { "answer": null } ' });
    assert.deepEqual(first.connection.transaction(apply), { changed: 1 });
    assert.throws(() => applySchemaChange(first.connection, plan), code('JD0021'));
    assert.deepEqual(await createDbMemoryStore(first.db.collection('memories')).get(unit.id), unit);
    assert.deepEqual({ ...first.native.get<Record<string, unknown>>({ from: 'host_notes' }) }, { id: 1, payload: ' { "answer": null } ', revision: 1 });
    assert.equal(first.connection.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='host_notes_payload'").get([])?.n, 1);
  } finally { await first.db.close(); }
  const reopened = await open(path, false);
  try {
    // The host receipt establishes completion; applying an old plan is not replay.
    assert.deepEqual({ ...reopened.native.get<Record<string, unknown>>({ from: 'host_migrations' }) }, { id: 1 });
    assert.deepEqual(await createDbMemoryStore(reopened.db.collection('memories')).get(unit.id), unit);
    assert.equal(reopened.native.get({ from: 'host_notes' })?.revision, 1);
    assert.equal((await reopened.db.integrityCheck()).ok, true);
  } finally { await reopened.db.close(); }
});

it('native schema plans refuse drift and enforce column references without changing neighboring Tangle records', async () => {
  const { db, connection, native } = await open();
  try {
    await db.collection('settings').put({ key: 'retain', value: { source: 'host' } });
    const stale = planSchemaChange(connection, { op: 'dropIndex', name: 'host_notes_payload' });
    applySchemaChange(connection, planSchemaChange(connection, { op: 'addColumn', table: 'host_notes',
      column: { name: 'owner_id', type: 'INTEGER', references: { table: 'host_owners', columns: ['id'] } } }));
    assert.throws(() => applySchemaChange(connection, stale), code('JD0021'));
    assert.throws(() => native.execute({ op: 'insert', table: 'host_notes', values: { id: 1, payload: '{}', owner_id: 99 } }), /FOREIGN KEY/i);
    assert.equal(native.get({ from: 'host_notes' }), undefined);
    native.execute({ op: 'insert', table: 'host_owners', values: { id: 99 } });
    native.execute({ op: 'insert', table: 'host_notes', values: { id: 1, payload: '{}', owner_id: 99 } });
    applySchemaChange(connection, planSchemaChange(connection, { op: 'dropIndex', name: 'host_notes_payload' }));
    applySchemaChange(connection, planSchemaChange(connection, { op: 'renameTable', table: 'host_migrations', to: 'host_migrations_retired' }));
    applySchemaChange(connection, planSchemaChange(connection, { op: 'dropTable', table: 'host_migrations_retired' }));
    assert.deepEqual(applySchemaChange(connection, planSchemaChange(connection, { op: 'dropTable', table: 'host_migrations_retired', ifExists: true })), { changed: 0 });
    assert.deepEqual(await db.collection('settings').get('retain'), { key: 'retain', value: { source: 'host' } });
    assert.equal((await db.foreignKeyCheck()).ok, true);
  } finally { await db.close(); }
});

it('native JSON inspection distinguishes missing, null and scalar metadata without rewriting the stored text', async () => {
  const { db, native } = await open();
  try {
    const payloads = ['{}', ' { "answer" : null } ', '{"answer":0}', '{"answer":"0"}', '{"answer":false}', '{"answer":[]}'];
    for (const [id, payload] of payloads.entries()) await db.entity('HostNote').mutate({ op: 'upsert', conflict: ['id'], onConflict: 'nothing', values: { id, payload } });
    const rows = native.all({ from: 'host_notes', columns: { payload: sql.column('payload'), kind: sql.call('json_type', [sql.column('payload'), '$.answer']) }, orderBy: [{ by: sql.column('id') }] });
    assert.deepEqual(rows.map(row => row.kind), [null, 'null', 'integer', 'text', 'false', 'array']);
    assert.deepEqual(rows.map(row => row.payload), payloads);
  } finally { await db.close(); }
});

it('host entity mutations keep each payload and output limit isolated from neighboring Tangle collection writes', async () => {
  const { db, native } = await open();
  try {
    const notes = db.entity('HostNote');
    await notes.mutate({ op: 'upsert', conflict: ['id'], onConflict: 'nothing', values: { id: 1, payload: 'initial' } });
    for (let index = 0; index < 96; index++) {
      const payload = `payload-${index}`;
      assert.deepEqual((await notes.mutate({ op: 'update', key: 1, set: { payload }, returning: ['payload'] })).rows, [{ payload }]);
      await db.collection('settings').put({ key: 'progress', value: index });
    }
    await assert.rejects(() => notes.mutate({ op: 'update', key: 1, set: { payload: 'refused' }, maxBytes: 1 }), code('JD2007'));
    assert.equal(native.get({ from: 'host_notes' })?.payload, 'payload-95');
    assert.deepEqual((await notes.mutate({ op: 'update', key: 1, set: { payload: 'last' }, returning: ['id'] })).rows, [{ id: 1 }]);
    assert.deepEqual(await db.collection('settings').get('progress'), { key: 'progress', value: 95 });
  } finally { await db.close(); }
});
