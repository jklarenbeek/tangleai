import { it } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, migrationStatus, openStore } from '@jarenjs/db';
import { fromPlanned } from '@jarenjs/linq/migration';
import { pickDriver, createDbMemoryStore } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';
import { initializeMigrationFixture, migrationBefore, migrationAfter, migrationOptions,
  planHostMigration, runPhysicalMigrationExample, type MigrationConnection } from '../../examples/physical-migration.ts';

const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
let next = 0;
async function location() {
  const supplied = process.env.TANGLE_FIXTURE_DIRECTORY;
  const directory = supplied ?? await mkdtemp(join(tmpdir(), 'tangle-migration-test-'));
  return { path: join(directory, `migration-${++next}.db`),
    close: async () => { if (!supplied) await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } };
}
async function fixture(t: TestContext) {
  const files = await location(), path = files.path, driver = pickDriver();
  let connection: MigrationConnection | undefined;
  t.after(async () => { try { await connection?.close(); } finally { await files.close(); } });
  const first = await driver.open(path) as MigrationConnection;
  try { await initializeMigrationFixture(first); } finally { await first.close(); }
  const db = await openStore(migrationBefore, { path, driver });
  try {
    await createDbMemoryStore(db.collection('memories')).put(createMemoryUnit({
      text: 'Original immutable evidence.', evidence: 'physical-migration/failure', at: '2026-09-13T00:00:00Z',
    }));
  } finally { await db.close(); }
  connection = await driver.open(path) as MigrationConnection;
  connection.exec('PRAGMA foreign_keys=ON');
  const owner = connection;
  const plan = await planHostMigration(connection, driver);
  const evidence = owner.prepare('SELECT * FROM memories').all([]);
  const historyCount = () => owner.prepare("SELECT name FROM sqlite_schema WHERE name='_jaren_migrations'").get([])
    ? owner.prepare('SELECT count(*) n FROM _jaren_migrations').get([])!.n : 0;
  const unchanged = () => {
    assert.deepEqual(owner.prepare('SELECT * FROM memories').all([]), evidence);
    assert.deepEqual({ ...owner.prepare('SELECT * FROM host_notes').get([]) }, { note_id: 1, label: 'original' });
    assert.equal(historyCount(), 0);
    assert.equal(owner.prepare('PRAGMA foreign_keys').get([])?.foreign_keys, 1);
  };
  return { connection, driver, path, plan, evidence, historyCount, unchanged };
}

it('saved native migration preserves Tangle memory and activated consolidation through reopen and zero-effect replay', async t => {
  const files = await location(); t.after(files.close);
  assert.deepEqual(await runPhysicalMigrationExample(files.path), {
    applied: 1, replayApplied: 0, historyRows: 1, exactMemories: 1,
    consolidationSources: 1, consolidationArtifacts: 1, physicalRequests: 0,
  });
});
it('native migration refuses stale source objects before changing Tangle or host rows', async t => {
  const f = await fixture(t);
  f.connection.exec('CREATE INDEX unexpected_source ON host_notes(label)');
  await assert.rejects(async () => migrate({ connection: f.connection }, [f.plan], migrationOptions(f.driver)), code('JD0020'));
  f.unchanged();
});
it('the disposable walkthrough refuses a pre-existing database before acquiring or changing it', async t => {
  const f = await fixture(t);
  await assert.rejects(runPhysicalMigrationExample(f.path), { code: 'EEXIST' });
  f.unchanged();
});
it('a primary failure after guarded table work rolls back transforms, schema and receipts with the borrowed handle open', async t => {
  const f = await fixture(t);
  const failing = { ...f.plan, steps: [...f.plan.steps,
    { kind: 'query', collection: 'HostNote', model: migrationAfter, assert: { $const: false }, expect: 'ebv' }] };
  await assert.rejects(async () => migrate({ connection: f.connection }, [failing], {
    ...migrationOptions(f.driver), shadow: false,
  }), code('JD0023'));
  f.unchanged();
  assert.equal(f.connection.prepare('SELECT 1 n').get([])?.n, 1);
  const applied = await migrate({ connection: f.connection }, [f.plan], migrationOptions(f.driver));
  assert.ok('applied' in applied); assert.deepEqual(applied.applied, ['host-note-revision']);
});
it('repeated startup refuses target drift and edited history without repeating writes', async t => {
  const f = await fixture(t), options = migrationOptions(f.driver);
  await migrate({ connection: f.connection }, [f.plan], options);
  const rows = f.connection.prepare('SELECT * FROM host_notes').all([]);
  await assert.rejects(async () => migrate({ connection: f.connection }, [{ ...f.plan, note: 'edited after apply' }], options), code('JD0022'));
  f.connection.exec('CREATE INDEX unexpected_target ON host_notes(label)');
  const status = await migrationStatus({ connection: f.connection }, [f.plan], { model: migrationAfter });
  assert.equal(status.upToDate, false); assert.match(status.drift!, /unexpected index:unexpected_target/);
  await assert.rejects(async () => migrate({ connection: f.connection }, [f.plan], options), code('JD0023'));
  assert.equal(f.historyCount(), 1);
  assert.deepEqual(f.connection.prepare('SELECT * FROM host_notes').all([]), rows);
  assert.deepEqual(f.connection.prepare('SELECT * FROM memories').all([]), f.evidence);
});
it('a same-file shadow is refused before its fixture runs and cancellation leaves primary evidence untouched', async t => {
  const f = await fixture(t); let fixtures = 0;
  await assert.rejects(async () => migrate({ connection: f.connection }, [f.plan], {
    ...migrationOptions(f.driver), shadowPath: f.path, shadowFixture: () => { fixtures++; },
  }), code('JD0021'));
  assert.equal(fixtures, 0); f.unchanged();
  await assert.rejects(async () => migrate({ connection: f.connection }, [f.plan], {
    ...migrationOptions(f.driver), signal: AbortSignal.abort(),
  }), code('JD2080'));
  f.unchanged();
});
it('the migration pen refuses a truncated saved table plan instead of dropping its native guards', async t => {
  const f = await fixture(t);
  const damaged = structuredClone(f.plan);
  const step = damaged.steps.find(step => step.kind === 'table'); assert.ok(step?.kind === 'table');
  Reflect.deleteProperty(step.plan, 'checksum');
  assert.throws(() => fromPlanned(damaged, { from: migrationBefore, to: migrationAfter }), code('JL0101'));
  f.unchanged();
});
