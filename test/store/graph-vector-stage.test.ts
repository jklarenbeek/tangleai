import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHashEmbedder } from '@tangleai/models';
import { createDocumentIngester, type PreparedOutcome } from '@tangleai/documents';
import { lightragMust } from '@tangleai/lightrag';
import { createGraphVectorStage, declareGraphVectors, openTangleDb, readGraphVectorState, createLightRagStore,
  disposeGraphVectorRollback, planGraphVectorMigration } from '@tangleai/store';
import { corpusFixture } from '../fixtures/corpus-promotion.ts';

const old = createHashEmbedder({ dims: 64 }), target = createHashEmbedder({ dims: 128 });
const identity = (embedder: typeof old) => ({ model: embedder.model, dims: embedder.dims });
const declaration = declareGraphVectors(identity(old), [identity(target)]);
function preparation(f: Awaited<ReturnType<typeof corpusFixture>>) {
  const prepared = new Map<string, PreparedOutcome>();
  return {
    prepareDocument: async (source: Parameters<Parameters<ReturnType<typeof createGraphVectorStage>['stage']>[0]['prepareDocument']>[0],
      context: Parameters<Parameters<ReturnType<typeof createGraphVectorStage>['stage']>[0]['prepareDocument']>[1]) => {
      const result = await createDocumentIngester({ store: context.documents, embedder: context.embedder, now: f.now, fetcher: f.fetcher })
        .prepare({ url: source.source.requestedUrl, maxTokens: 80, overlapTokens: 16 });
      prepared.set(source.source.id, result); return result;
    },
    graph: async (source: Parameters<Parameters<ReturnType<typeof createGraphVectorStage>['stage']>[0]['graph']>[0]) =>
      f.makeGraphOptions(prepared.get(source.source.id)!, () => f.reply(new URL(source.source.requestedUrl).pathname.slice(1), 1)),
  };
}
it('complete graph staging leaves the live corpus intact, swaps atomically and rolls back with retained preparations', { timeout: 60000 }, async () => {
  const db = await openTangleDb({ graphVectors: declaration }), staging = await openTangleDb({ graphVectors: declaration });
  const rollbackDb = await openTangleDb({ graphVectors: declaration });
  let fail = '';
  const f = await corpusFixture({ db, dims: 64 });
  try {
    await f.activate('a'); await f.activate('b');
    const before = await f.snapshot(), originalEntities = await f.graph.listEntities(), originalRelations = await f.graph.listRelations();
    const stage = createGraphVectorStage({ db, staging, declaration, embedder: target, operationKey: 'fixture-64-to-128', now: f.now,
      applyProbe: step => { if (step === fail) throw new Error('Injected joint failure at ' + step); } });
    assert.ok(lightragMust(await stage.initialize()).copiedRows > 0); assert.deepEqual(await f.snapshot(), before);
    const prepared = lightragMust(await stage.stage(preparation(f)));
    assert.equal(prepared.status, 'complete', JSON.stringify(prepared.failure)); assert.equal(prepared.work.staged, 2);
    assert.ok(prepared.work.embeddingCalls > 0); assert.deepEqual(await f.snapshot(), before);
    const repeat = lightragMust(await stage.stage(preparation(f)));
    assert.equal(repeat.work.skipped, 2); assert.equal(repeat.work.embeddingCalls, 0); assert.equal(repeat.work.writes, 0);
    for (const step of ['put:document_versions', 'graph:put:entities', 'swap:commit']) {
      fail = step; assert.equal((await stage.promote()).valid, false, step);
      assert.deepEqual(await f.snapshot(), before, step); assert.equal(await readGraphVectorState(db), null);
    }
    fail = '';
    const swaps = (await Promise.all([stage.promote(), stage.promote()])).map(lightragMust);
    assert.equal(swaps.reduce((sum, row) => sum + row.swaps, 0), 1);
    assert.equal(swaps.filter(row => row.replayed).length, 1);
    await f.citations(); assert.deepEqual((await readGraphVectorState(db))!.active, identity(target));
    for (const row of [...await f.graph.listEntities(), ...await f.graph.listRelations()]) assert.equal(row.embedding.length, 128);
    const current = await f.snapshot(); assert.equal(lightragMust(await stage.promote()).swaps, 0); assert.deepEqual(await f.snapshot(), current);
    const rollback = createGraphVectorStage({ db, staging: rollbackDb, declaration: declareGraphVectors(identity(target), [identity(old)]),
      embedder: old, operationKey: 'fixture-128-to-64', now: f.now });
    lightragMust(await rollback.initialize()); const returned = lightragMust(await rollback.stage(preparation(f)));
    assert.equal(returned.status, 'complete', JSON.stringify(returned.failure)); assert.equal(returned.work.embeddingCalls, 0);
    assert.equal(lightragMust(await rollback.promote()).swaps, 1); await f.citations();
    assert.deepEqual((await readGraphVectorState(db))!.active, identity(old));
    assert.deepEqual(await f.graph.listEntities(), originalEntities); assert.deepEqual(await f.graph.listRelations(), originalRelations);
    assert.equal(lightragMust(await stage.promote()).swaps, 0); assert.deepEqual((await readGraphVectorState(db))!.active, identity(old));
  } finally { await rollbackDb.close(); await staging.close(); await db.close(); }
});

it('failed embedding resumes after file reopen, retention disposal is fenced, and abandonment preserves evidence', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-stage-'));
  let db = await openTangleDb({ path: join(directory, 'live.db'), graphVectors: declaration });
  let staging = await openTangleDb({ path: join(directory, 'stage.db'), graphVectors: declaration });
  let fail = true;
  const embedder = { ...target, embed: async (...args: Parameters<typeof target.embed>) => {
    if (fail) throw new Error('Synthetic embedding failure.'); return target.embed(...args);
  } };
  const f = await corpusFixture({ db, dims: 64 });
  const stageOptions = () => ({ db, staging, declaration, embedder, operationKey: 'durable-resume', now: f.now });
  try {
    await f.activate('a'); await f.activate('b'); const before = await f.graph.listEntities();
    let stage = createGraphVectorStage(stageOptions()); lightragMust(await stage.initialize());
    const failure = lightragMust(await stage.stage(preparation(f)));
    assert.equal(failure.status, 'incomplete'); assert.equal(failure.work.failed, 1); assert.equal(failure.work.embeddingCalls, 1);
    assert.equal((await stage.promote()).valid, false); assert.deepEqual(await f.graph.listEntities(), before);
    await staging.close(); await db.close(); fail = false;
    db = await openTangleDb({ path: join(directory, 'live.db'), graphVectors: declaration });
    staging = await openTangleDb({ path: join(directory, 'stage.db'), graphVectors: declaration });
    stage = createGraphVectorStage(stageOptions()); assert.equal(lightragMust(await stage.initialize()).copiedRows, 0);
    assert.equal(lightragMust(await stage.stage(preparation(f))).status, 'complete');
    assert.deepEqual(await createLightRagStore(db).listEntities(), before);
    const promoted = lightragMust(await stage.promote()), state = (await readGraphVectorState(db))!;
    assert.equal(state.retained.length, 1);
    const both = declareGraphVectors(identity(target), [identity(old)]), onlyTarget = declareGraphVectors(identity(target));
    assert.throws(() => planGraphVectorMigration(both, onlyTarget, 'remove-retained', { dropState: state }), { code: 'TVEC1003' });
    const disposal = { id: promoted.id, expectedRevision: state.revision, reason: 'Synthetic host retention decision.' };
    assert.equal((await disposeGraphVectorRollback(db, { ...disposal, expectedRevision: 42 })).valid, false);
    assert.equal(lightragMust(await disposeGraphVectorRollback(db, disposal)).writes, 2);
    assert.equal(lightragMust(await disposeGraphVectorRollback(db, disposal)).writes, 0);
    assert.equal((await disposeGraphVectorRollback(db, { ...disposal, reason: 'Changed authority.' })).valid, false);
    assert.equal((await readGraphVectorState(db))!.retained.length, 0);
    assert.deepEqual(planGraphVectorMigration(both, onlyTarget, 'remove-disposed', { dropState: (await readGraphVectorState(db))! }).removedWidths, [64]);
    const abandonedDb = await openTangleDb({ graphVectors: both });
    try {
      const abandoned = createGraphVectorStage({ db, staging: abandonedDb, declaration: both, embedder: old,
        operationKey: 'explicitly-abandoned', now: f.now });
      lightragMust(await abandoned.initialize());
      const live = await createLightRagStore(db).listEntities();
      assert.equal(lightragMust(await abandoned.abandon('Host stopped the pending stage.')).writes, 1);
      assert.equal(lightragMust(await abandoned.abandon('Host stopped the pending stage.')).writes, 0);
      assert.equal((await abandoned.stage(preparation(f))).valid, false); assert.equal((await abandoned.promote()).valid, false);
      assert.deepEqual(await createLightRagStore(db).listEntities(), live);
    } finally { await abandonedDb.close(); }
  } finally { await staging.close(); await db.close(); await rm(directory, { recursive: true, force: true }); }
});

it('an interrupted stage requires explicit fenced recovery and a changed source corpus refuses the final swap', async () => {
  const db = await openTangleDb({ graphVectors: declaration }), staging = await openTangleDb({ graphVectors: declaration });
  const f = await corpusFixture({ db, dims: 64 }); let interrupt = true;
  try {
    await f.activate('a'); await f.activate('b'); const before = await f.snapshot();
    const stage = createGraphVectorStage({ db, staging, declaration, embedder: target, operationKey: 'interruption', now: f.now,
      applyProbe: step => { if (interrupt && step === 'stage:claimed') throw new Error('Interrupted after durable claim.'); } });
    lightragMust(await stage.initialize()); assert.equal((await stage.stage(preparation(f))).valid, false);
    interrupt = false; assert.equal((await stage.stage(preparation(f))).valid, false);
    const result = lightragMust(await stage.stage({ ...preparation(f), resumeInterrupted: true }));
    assert.equal(result.status, 'complete', JSON.stringify(result.failure)); assert.equal(result.work.interrupted, 1);
    assert.deepEqual(await f.snapshot(), before); await f.activate('c'); const changed = await f.snapshot();
    const refused = await stage.promote(); assert.equal(refused.valid, false);
    if (!refused.valid) assert.equal(refused.issues[0].cause?.code, 'TVEC1003');
    assert.deepEqual(await f.snapshot(), changed);
  } finally { await staging.close(); await db.close(); }
});

it('persisted journal or primary reservation corruption refuses before preparing a source', async () => {
  const db = await openTangleDb({ graphVectors: declaration }), staging = await openTangleDb({ graphVectors: declaration });
  const f = await corpusFixture({ db, dims: 64 });
  try {
    await f.activate('a'); const before = await f.snapshot();
    const stage = createGraphVectorStage({ db, staging, declaration, embedder: target, operationKey: 'corruption', now: f.now });
    const initialized = lightragMust(await stage.initialize()), key = 'lightrag:vector:reservation:' + initialized.journal.id;
    const settings = db.collection<{ key: string; value: Record<string, unknown> }>('settings'), reserved = (await settings.get(key))!;
    await settings.put({ ...reserved, value: { ...reserved.value, widths: [] } });
    assert.equal((await stage.stage(preparation(f))).valid, false);
    assert.deepEqual(await f.snapshot(), before);
    await settings.put(reserved);
    const journal = staging.collection<{ key: string; value: Record<string, unknown> }>('settings'), stored = (await journal.get('lightrag:vector:stage'))!;
    await journal.put({ ...stored, value: { ...stored.value, failed: -1 } });
    await assert.rejects(stage.inspect(), { code: 'TVEC1003' });
    assert.deepEqual(await f.snapshot(), before);
  } finally { await staging.close(); await db.close(); }
});

it('a model-only identity change stages the complete corpus using the existing width', async () => {
  const alternate = { ...old, model: 'alternate-hash-64' }, columns = declareGraphVectors(identity(old), [identity(alternate)]);
  const db = await openTangleDb({ graphVectors: columns }), staging = await openTangleDb({ graphVectors: columns });
  const f = await corpusFixture({ db, dims: 64 });
  try {
    assert.deepEqual(columns.widths, [64]); await f.activate('a'); await f.activate('b');
    const stage = createGraphVectorStage({ db, staging, declaration: columns, embedder: alternate, operationKey: 'same-width-model', now: f.now });
    lightragMust(await stage.initialize()); const prepared = lightragMust(await stage.stage(preparation(f)));
    assert.equal(prepared.status, 'complete'); assert.ok(prepared.work.embeddingCalls > 0);
    lightragMust(await stage.promote()); assert.deepEqual((await readGraphVectorState(db))!.active, identity(alternate));
    for (const row of [...await f.graph.listEntities(), ...await f.graph.listRelations()]) assert.deepEqual(row.embeddedBy, identity(alternate));
    await f.citations();
  } finally { await staging.close(); await db.close(); }
});

it('separate native connections admit one complete swap and replay its durable receipt', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-concurrent-')), path = join(directory, 'live.db');
  const db = await openTangleDb({ path, graphVectors: declaration }), second = await openTangleDb({ path, graphVectors: declaration });
  const staging = await openTangleDb({ graphVectors: declaration }), f = await corpusFixture({ db, dims: 64 });
  try {
    await f.activate('a'); await f.activate('b');
    const options = { staging, declaration, embedder: target, operationKey: 'two-connections', now: f.now };
    const first = createGraphVectorStage({ ...options, db }), other = createGraphVectorStage({ ...options, db: second });
    lightragMust(await first.initialize()); assert.equal(lightragMust(await first.stage(preparation(f))).status, 'complete');
    const outcomes = await Promise.all([first.promote(), other.promote()]);
    assert.equal(outcomes.reduce((sum, result) => sum + (result.valid ? result.value.swaps : 0), 0), 1);
    assert.equal(lightragMust(await first.promote()).swaps, 0); assert.equal(lightragMust(await other.promote()).swaps, 0);
    assert.equal((await readGraphVectorState(second))!.revision, 1); await f.citations();
  } finally { await staging.close(); await second.close(); await db.close(); await rm(directory, { recursive: true, force: true }); }
});


it('rollback disposal snapshots its validated authority and reason before queued work', async () => {
  for (const field of ['reason', 'id', 'expectedRevision'] as const) {
    const db = await openTangleDb({ graphVectors: declaration }), staging = await openTangleDb({ graphVectors: declaration });
    const f = await corpusFixture({ db, dims: 64 });
    try {
      await f.activate('a');
      const stage = createGraphVectorStage({ db, staging, declaration, embedder: target, operationKey: 'disposal-snapshot-' + field, now: f.now });
      lightragMust(await stage.initialize()); lightragMust(await stage.stage(preparation(f)));
      const promoted = lightragMust(await stage.promote()), state = (await readGraphVectorState(db))!;
      const input = { id: promoted.id, expectedRevision: state.revision, reason: 'Reviewed retention decision.' }, expected = { ...input };
      const pending = disposeGraphVectorRollback(db, input);
      if (field === 'expectedRevision') input.expectedRevision++;
      else input[field] = '';
      assert.equal(lightragMust(await pending).writes, 2);
      const audit = await db.collection<{ key: string; value: { input: typeof expected } }>('settings').get('lightrag:vector:disposal:' + expected.id);
      assert.deepEqual(audit!.value.input, expected);
      assert.equal(lightragMust(await disposeGraphVectorRollback(db, expected)).writes, 0);
    } finally { await staging.close(); await db.close(); }
  }
});

it('staging retains the operation identity supplied at construction', async () => {
  const db = await openTangleDb({ graphVectors: declaration }), staging = await openTangleDb({ graphVectors: declaration });
  const f = await corpusFixture({ db, dims: 64 });
  try {
    await f.activate('a');
    const options = { db, staging, declaration, embedder: target, operationKey: 'captured-stage-operation', now: f.now };
    const stage = createGraphVectorStage(options);
    options.operationKey = '';
    const initialized = lightragMust(await stage.initialize());
    assert.equal(initialized.journal.operationKey, 'captured-stage-operation');
    assert.equal(lightragMust(await stage.initialize()).writes, 0);
    lightragMust(await stage.abandon('Discard the disposable operation snapshot.'));
  } finally { await staging.close(); await db.close(); }
});
