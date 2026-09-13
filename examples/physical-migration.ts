/** Offline host migration through Jaren's saved plans; all example data is synthetic. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, createModelShape, planTable, planTableMigration, applyTableMigration,
  planPhysicalMigration, readSchema, migrate, migrationStatus, type Driver } from '@jarenjs/db';
import { defineModel, object, integer, string } from '@jarenjs/linq/model';
import { defineMigration, fromPlanned } from '@jarenjs/linq/migration';
import { TANGLE_DB_MODEL, pickDriver, createDbMemoryStore, createConsolidationDbStore } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';
import { createConsolidationSource, createConsolidationRunner, type ConsolidationResult } from '@tangleai/memory/consolidation';

// Driver.open intentionally returns unknown. This example selects only the
// published synchronous SQLite drivers and observes this small native surface.
export interface MigrationConnection {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(params: readonly unknown[]): Record<string, unknown> | undefined;
    all(params: readonly unknown[]): Record<string, unknown>[];
  };
  close(): unknown;
}
const columns = {
  id: { name: 'note_id', codec: 'integer', null: 'reject' },
  label: { name: 'label', codec: 'text', null: 'reject' },
} as const;
const oldHost = defineModel({ entities: { HostNote: object({ id: integer().key(), label: string() })
  .physical({ table: 'host_notes', columns }) } });
const newHost = defineModel({ entities: { HostNote: object({ id: integer().key(), label: string(), revision: integer() })
  .physical({ table: 'host_notes', columns: { ...columns,
    revision: { name: 'revision', codec: 'integer', null: 'reject', default: 'database' } } }) } });
export const migrationBefore = { ...TANGLE_DB_MODEL, entities: oldHost.entities };
export const migrationAfter = { ...TANGLE_DB_MODEL, entities: newHost.entities };
const oldTable = { name: 'host_notes', primaryKey: ['note_id'], columns: [
  { name: 'note_id', type: 'INTEGER' as const, identity: 'autoincrement' as const, nullable: false },
  { name: 'label', type: 'TEXT' as const, nullable: false },
] };
const newTable = { ...oldTable, columns: [...oldTable.columns,
  { name: 'revision', type: 'INTEGER' as const, nullable: false, default: 1 }] };

/** Independent historical schema and synthetic rows; never a snapshot of user data. */
export async function initializeMigrationFixture(connection: MigrationConnection) {
  connection.exec('PRAGMA foreign_keys=ON');
  for (const statement of planTable(oldTable).createSql) connection.exec(statement);
  await createModelShape(connection, migrationBefore);
  connection.exec("INSERT INTO host_notes VALUES(1,'original'); INSERT INTO host_notes VALUES(99,'retired'); DELETE FROM host_notes WHERE note_id=99");
}

/** Plan only. Persist and review the resulting immutable document before real use. */
export async function planHostMigration(connection: MigrationConnection, driver: Driver) {
  const tablePlan = planTableMigration(connection, newTable, { id: 'host-note-revision', allowRebuild: true });
  const reference = await driver.open(':memory:') as MigrationConnection;
  let physicalTarget;
  try {
    await initializeMigrationFixture(reference);
    await applyTableMigration(reference, tablePlan);
    physicalTarget = { objects: (await readSchema(reference, { tables: ['host_notes'] })).objects, tables: ['host_notes'] };
  } finally { await reference.close(); }
  const steps = defineMigration({ id: 'host-note-revision', from: migrationBefore, to: migrationAfter })
    .assert('HostNote', row => row.label.isEmpty(), { model: oldHost })
    .transform('HostNote', row => ({ id: row.id, label: row.label.upper() }), { model: oldHost })
    .step({ kind: 'table', plan: tablePlan })
    .assert('HostNote', row => row.revision.lt(1), { model: newHost }).document.steps;
  const inventory = await readSchema(connection);
  const plan = await planPhysicalMigration(connection, migrationBefore, migrationAfter, {
    id: 'host-note-revision', steps, physicalTarget,
    dispositions: Object.fromEntries(inventory.objects.map(item =>
      [`${item.type}:${item.name}`, item.name === 'host_notes' ? 'replace' as const : 'preserve' as const])),
  });
  return fromPlanned(plan, { from: migrationBefore, to: migrationAfter }).document;
}
export const migrationOptions = (driver: Driver) => ({ baseline: migrationBefore, model: migrationAfter,
  shadowDriver: driver, shadowFixture: (connection: unknown) => initializeMigrationFixture(connection as MigrationConnection) });
const must = <T>(result: ConsolidationResult<T>): T => {
  if (result.status !== 'success') throw new Error(result.detail);
  return result.value;
};

/** The path must name a new disposable database; an application supplies its own reviewed chain. */
export async function runPhysicalMigrationExample(path: string, driver: Driver = pickDriver()) {
  if (path === ':memory:') throw new TypeError('The reopen example requires a new disposable file');
  await (await open(path, 'wx')).close();
  const setup = await driver.open(path) as MigrationConnection;
  try { await initializeMigrationFixture(setup); } finally { await setup.close(); }
  const unit = createMemoryUnit({ text: 'Keep this exact evidence.', evidence: 'host-migration/example', at: '2026-09-13T00:00:00Z' });
  const db = await openStore(migrationBefore, { path, driver });
  let retained;
  try {
    await createDbMemoryStore(db.collection('memories')).put(unit);
    const store = createConsolidationDbStore(db);
    const source = must(await createConsolidationSource({ scope: 'host-migration', key: 'source-1', sequence: 0, snapshot: unit }));
    const runner = createConsolidationRunner({ store, now: () => 1789257600000, policy: { enabled: true } });
    try {
      must(await runner.enqueue([source]));
      must(await runner.run({ scope: source.scope, key: 'consolidate-1', trigger: 'manual' }));
      retained = must(await store.snapshot(source.scope));
    } finally { await runner.close(); }
  } finally { await db.close(); }

  // The application is quiescent: no Store or worker uses this file during DDL.
  const connection = await driver.open(path) as MigrationConnection;
  let saved;
  try {
    connection.exec('PRAGMA foreign_keys=ON');
    const document = await planHostMigration(connection, driver);
    saved = JSON.parse(JSON.stringify(document)) as typeof document;
    const options = migrationOptions(driver);
    const preview = await migrate({ connection }, [saved], { ...options, dryRun: true });
    assert.ok('dryRun' in preview && preview.shadowValidated);
    assert.equal(connection.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='_jaren_migrations'").get([])?.n, 0);
    const applied = await migrate({ connection }, [saved], options);
    assert.ok('applied' in applied); assert.deepEqual(applied.applied, ['host-note-revision']);
    assert.deepEqual({ ...connection.prepare('SELECT * FROM host_notes').get([]) }, { note_id: 1, label: 'ORIGINAL', revision: 1 });
  } finally { await connection.close(); }

  const reopened = await driver.open(path) as MigrationConnection;
  try {
    reopened.exec('PRAGMA foreign_keys=ON');
    const replay = await migrate({ connection: reopened }, [saved], migrationOptions(driver));
    assert.ok('upToDate' in replay && replay.upToDate); assert.deepEqual(replay.applied, []);
    assert.equal((await migrationStatus({ connection: reopened }, [saved], { model: migrationAfter })).upToDate, true);
    assert.equal(reopened.prepare('SELECT count(*) n FROM _jaren_migrations').get([])?.n, 1);
    assert.equal(reopened.prepare("SELECT seq FROM sqlite_sequence WHERE name='host_notes'").get([])?.seq, 99);
  } finally { await reopened.close(); }
  const current = await openStore(migrationAfter, { path, driver });
  try {
    assert.deepEqual(await createDbMemoryStore(current.collection('memories')).get(unit.id), unit);
    assert.deepEqual(must(await createConsolidationDbStore(current).snapshot('host-migration')), retained);
    assert.equal((await current.integrityCheck()).ok, true);
  } finally { await current.close(); }
  return { applied: 1, replayApplied: 0, historyRows: 1, exactMemories: 1,
    consolidationSources: retained.sources.length, consolidationArtifacts: retained.artifacts.length, physicalRequests: 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const supplied = process.env.TANGLE_FIXTURE_DIRECTORY;
  const directory = supplied ?? await mkdtemp(join(tmpdir(), 'tangle-physical-migration-'));
  try { console.log(JSON.stringify(await runPhysicalMigrationExample(join(directory, 'example.db')), null, 2)); }
  finally { if (!supplied) await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
}
