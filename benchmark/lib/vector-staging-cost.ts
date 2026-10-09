/** Complete isolated 128-D preparation is measured separately from 64-D reads. */
import { stat } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createHashEmbedder } from '@tangleai/models';
import { lightragMust } from '@tangleai/lightrag';
import { openTangleDb, declareGraphVectors, planGraphVectorMigration, applyGraphVectorMigrations, createGraphVectorStage } from '@tangleai/store';
import { prepareGraphLadderDocument, graphLadderPreparation, type syntheticGraphLadderCorpus } from './lightrag-ladder-corpus.ts';
import type { createVectorSqlObserver } from './vector-observation.ts';
import type { VectorStageCost } from './vector-scale.types.ts';

export async function vectorStorageBytes(path: string) {
  return (await Promise.all([path, path + '-wal', path + '-shm'].map(async file => {
    try { return (await stat(file)).size; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw cause; }
  }))).reduce((sum, bytes) => sum + bytes, 0);
}
export const vectorReadDeclaration = declareGraphVectors({ model: 'hash-trigram-64', dims: 64 });
export const vectorReadMigration = () => planGraphVectorMigration(null, vectorReadDeclaration, 'graph-vector-64');
export async function measureVectorStaging(options: { path: string; stagingPath: string; size: number;
  corpus: ReturnType<typeof syntheticGraphLadderCorpus>; observer: ReturnType<typeof createVectorSqlObserver>; timer: () => number }): Promise<VectorStageCost> {
  const { observer, timer } = options, embedder = createHashEmbedder({ dims: 128 });
  const declaration = declareGraphVectors(vectorReadDeclaration.active, [{ model: embedder.model, dims: embedder.dims }]);
  const add = planGraphVectorMigration(vectorReadDeclaration, declaration, 'graph-vector-stage-128');
  observer.reset(); const started = timer();
  const migrated = await applyGraphVectorMigrations({ driver: observer.driver, path: options.path }, [vectorReadMigration(), add], { baseline: null, driver: observer.driver });
  if (!('applied' in migrated.result) || migrated.result.applied.length !== 1 || !migrated.status?.upToDate) throw new Error('The staging column migration did not settle.');
  const columnMigrationMs = timer() - started;
  const db = await openTangleDb({ path: options.path, driver: observer.driver, graphVectors: declaration });
  const staging = await openTangleDb({ path: options.stagingPath, driver: observer.driver, graphVectors: declaration });
  try {
    const stage = createGraphVectorStage({ db, staging, declaration, embedder, operationKey: 'registered-scale-' + options.size, now: () => '2026-06-01T00:00:00.000Z' });
    const initialization = timer(), initialized = lightragMust(await stage.initialize()), initializeMs = timer() - initialization;
    const preparation = timer(), prepared = lightragMust(await stage.stage({
      prepareDocument: (_source, context) => prepareGraphLadderDocument(options.corpus, options.size, context.documents, context.embedder),
      graph: (_source, document) => graphLadderPreparation(document, options.corpus, embedder),
    })), prepareMs = timer() - preparation;
    if (prepared.status !== 'complete' || prepared.work.failed || prepared.work.interrupted || prepared.work.staged !== 1)
      throw new Error('The complete registered graph stage failed: ' + JSON.stringify(prepared.failure));
    const abandoned = lightragMust(await stage.abandon('Completed isolated benchmark preparation; no live identity swap requested.'));
    return { totalMs: timer() - started, columnMigrationMs, columnMigrationSteps: add.migration.steps.length, initializeMs, prepareMs,
      copiedRows: initialized.copiedRows, ...prepared.work, writes: initialized.writes + prepared.work.writes + abandoned.writes,
      storageBytes: await vectorStorageBytes(options.stagingPath), sql: observer.snapshot(),
      target: { model: 'hash-trigram-128', dims: 128 }, abandoned: true, journalDigest: await canonicalSha256(prepared.journal) };
  } finally { await staging.close(); await db.close(); }
}
