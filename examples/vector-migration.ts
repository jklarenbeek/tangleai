/** Disposable, entirely synthetic graph migration; no application path is opened. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelShape, type Driver } from '@jarenjs/db';
import { createHashEmbedder } from '@tangleai/models';
import { lightragMust } from '@tangleai/lightrag';
import { openTangleDb, pickDriver, declareGraphVectors, planGraphVectorMigration, applyGraphVectorMigrations,
  createGraphVectorStage, createLightRagStore, createGraphVectorRank, readGraphVectorState, disposeGraphVectorRollback,
  GRAPH_VECTOR_STATE_KEY, TANGLE_DB_MODEL } from '@tangleai/store';
import { loadLightRagFixture } from '../benchmark/lib/lightrag.ts';
import { createLightRagLadderCorpus, prepareGraphLadderDocument, graphLadderPreparation } from '../benchmark/lib/lightrag-ladder-corpus.ts';

export async function runVectorMigrationExample(directory: string, driver: Driver = pickDriver()) {
  const path = join(directory, 'graph.db'), stagePath = join(directory, 'stage.db'), rollbackPath = join(directory, 'rollback.db');
  for (const file of [path, stagePath, rollbackPath]) await (await open(file, 'wx')).close();
  const original = createHashEmbedder({ dims: 64 }), target = createHashEmbedder({ dims: 128 });
  const identity = (embedder: typeof original) => ({ model: embedder.model, dims: embedder.dims });
  const first = declareGraphVectors(identity(original)), both = declareGraphVectors(identity(original), [identity(target)]);
  const now = () => '2026-06-01T00:00:00.000Z';
  let db = await openTangleDb({ path, driver }), closed = false;
  const close = async () => { if (!closed) { await db.close(); closed = true; } };
  try {
    const corpus = await createLightRagLadderCorpus(await loadLightRagFixture(), 2, db, () => 0);
    const before = { entities: await corpus.graph.listEntities(), relations: await corpus.graph.listRelations() };
    await close();
    // Persisted JSON plans are the same plans inspected and applied below.
    const add64 = JSON.parse(JSON.stringify(planGraphVectorMigration(null, first, 'example-graph-64')));
    let dryRunCause: string | null = null;
    try { await applyGraphVectorMigrations({ driver, path }, [add64], { baseline: null, driver, dryRun: true }); }
    catch (error) {
      const cause = (error as Error).cause as { code?: string } | undefined;
      if (cause?.code !== 'JD0023') throw error;
      dryRunCause = cause.code;
    }
    // Pinned Jaren's derive preview currently refuses after its shadow succeeds.
    // Actual application still performs native shadow validation and backfill.
    const applied = await applyGraphVectorMigrations({ driver, path }, [add64], { baseline: null, driver });
    assert.ok('applied' in applied.result); assert.deepEqual(applied.result.applied, ['example-graph-64']);
    const add128 = JSON.parse(JSON.stringify(planGraphVectorMigration(first, both, 'example-graph-128')));
    await applyGraphVectorMigrations({ driver, path }, [add64, add128], { baseline: null, driver });
    db = await openTangleDb({ path, driver, graphVectors: both }); closed = false;
    const stageDb = await openTangleDb({ path: stagePath, driver, graphVectors: both });
    const rollbackDb = await openTangleDb({ path: rollbackPath, driver, graphVectors: both });
    let retainedState;
    let stageEmbeddingCalls = 0, rollbackEmbeddingCalls = 0;
    try {
      const rank = createGraphVectorRank(db, first);
      const probe = await original.embed(['registered graph']);
      await rank.rows({ kind: 'entity', identity: identity(original), vector: probe[0] });
      assert.equal(rank.diagnostics().native.diverted, 0); assert.ok(rank.diagnostics().proofs.length);
      const prepare = (embedder: typeof original) => ({
        prepareDocument: (_source: unknown, context: Parameters<Parameters<ReturnType<typeof createGraphVectorStage>['stage']>[0]['prepareDocument']>[1]) =>
          prepareGraphLadderDocument(corpus.corpus, 2, context.documents, context.embedder),
        graph: (_source: unknown, document: Parameters<typeof graphLadderPreparation>[0]) => graphLadderPreparation(document, corpus.corpus, embedder),
      });
      const stage = createGraphVectorStage({ db, staging: stageDb, declaration: both, embedder: target, operationKey: 'example-to-128', now });
      lightragMust(await stage.initialize());
      const staged = lightragMust(await stage.stage(prepare(target))); assert.equal(staged.status, 'complete'); stageEmbeddingCalls = staged.work.embeddingCalls;
      assert.deepEqual(await createLightRagStore(db).listEntities(), before.entities);
      lightragMust(await stage.promote()); assert.equal(lightragMust(await stage.promote()).swaps, 0);
      assert.deepEqual((await readGraphVectorState(db))!.active, identity(target));
      const rollback = createGraphVectorStage({ db, staging: rollbackDb, declaration: declareGraphVectors(identity(target), [identity(original)]),
        embedder: original, operationKey: 'example-back-to-64', now });
      lightragMust(await rollback.initialize()); const returned = lightragMust(await rollback.stage(prepare(original)));
      assert.equal(returned.status, 'complete'); rollbackEmbeddingCalls = returned.work.embeddingCalls; assert.equal(rollbackEmbeddingCalls, 0);
      lightragMust(await rollback.promote()); assert.equal(lightragMust(await rollback.promote()).swaps, 0);
      assert.deepEqual(await createLightRagStore(db).listEntities(), before.entities);
      assert.deepEqual(await createLightRagStore(db).listRelations(), before.relations);
      const state = (await readGraphVectorState(db))!, retained128 = state.retained.find(row => row.identity.dims === 128)!;
      lightragMust(await disposeGraphVectorRollback(db, { id: retained128.id, expectedRevision: state.revision, reason: 'Synthetic host relinquishes 128-D rollback authority.' }));
      retainedState = (await readGraphVectorState(db))!;
    } finally { await rollbackDb.close(); await stageDb.close(); }
    await close();
    const drop = JSON.parse(JSON.stringify(planGraphVectorMigration(both, first, 'example-drop-128', { dropState: retainedState })));
    const options = { baseline: null, driver, shadowFixture: async (connection: unknown) => {
      // This is only the example's synthetic retained state. Hosts supply their
      // own independent historical fixture when reviewing a removal plan.
      await createModelShape(connection, TANGLE_DB_MODEL);
      const native = connection as { prepare(sql: string): { run(values: unknown[]): unknown } };
      native.prepare('INSERT INTO settings (key,doc) VALUES (?,jsonb(?))').run([GRAPH_VECTOR_STATE_KEY,
        JSON.stringify({ key: GRAPH_VECTOR_STATE_KEY, value: retainedState })]);
    } };
    const removed = await applyGraphVectorMigrations({ driver, path }, [add64, add128, drop], options);
    assert.ok('applied' in removed.result); assert.deepEqual(removed.result.applied, ['example-drop-128']);
    const replay = await applyGraphVectorMigrations({ driver, path }, [add64, add128, drop], options);
    assert.ok('applied' in replay.result); assert.deepEqual(replay.result.applied, []);
    db = await openTangleDb({ path, driver, graphVectors: first }); closed = false;
    assert.deepEqual(await createLightRagStore(db).listEntities(), before.entities);
    assert.deepEqual(await createLightRagStore(db).listRelations(), before.relations);
    assert.equal((await db.integrityCheck()).ok, true);
    return { migrations: 3, replayedMigrations: replay.result.applied.length, identitySwaps: 2, exactRollback: true,
      stageEmbeddingCalls, rollbackEmbeddingCalls, dryRunCause, physicalRequests: 0 };
  } finally { await close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-example-'));
  try { console.log(JSON.stringify(await runVectorMigrationExample(directory), null, 2)); }
  finally { await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
}
