import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount } from '@tangleai/agents';
import { retrieveLightRag, lightragMust, type LightRagStore } from '@tangleai/lightrag';
import { openTangleDb, declareGraphVectors, createGraphVectorRank } from '@tangleai/store';
import { retrievalFixture } from '../fixtures/lightrag-retrieval.ts';
import { compareGraphRetrieval } from '../../benchmark/lib/vector-parity.ts';

const declaration = declareGraphVectors({ model: 'hash-trigram-64', dims: 64 });
it('native graph retrieval preserves every mode, bound, trace, context and citation, including invalid-vector rejection', async t => {
  const f = await retrievalFixture({ db: await openTangleDb({ graphVectors: declaration }) });
  const rank = createGraphVectorRank(f.db, declaration), native = { ...f.graph, rankRows: rank.rows }; let cases = 0;
  try {
    for (const corrupt of [false, true]) {
      if (corrupt) for (const entity of await f.graph.listEntities()) {
        const collection = f.db.collection<{ id: string; payload: typeof entity }>('lightrag_entities'), stored = (await collection.get(entity.id))!;
        if (entity.name === 'Bridge') await collection.put({ ...stored, payload: { ...entity, embeddedBy: { ...entity.embeddedBy, model: 'foreign' } } });
        if (entity.name === 'Far') await collection.put({ ...stored, payload: { ...entity, embedding: [1] } });
      }
      for (const mode of ['low', 'high', 'hybrid', 'hybrid-no-original'] as const) for (const contextTokens of [0, 64, 4000])
        for (const candidatesPerKeyword of [1, 10]) {
          const limits = { contextTokens, candidatesPerKeyword, expansionEntities: 1, expansionRelations: 1, chunksPerSource: 1 };
          const baseline = await f.retrieve(mode, limits), actual = await f.retrieve(mode, limits, native);
          assert.deepEqual(compareGraphRetrieval(baseline, actual), { equal: true, differences: 0, paths: [] }); cases++;
        }
    }
    assert.equal(rank.diagnostics().native.diverted, 0); assert.equal(rank.diagnostics().fallback, 0);
    t.diagnostic(JSON.stringify({ completeRetrievalCases: cases, nativeQueries: rank.diagnostics().native.queries, physicalRequests: 0 }));
  } finally { await f.db.close(); }
});

it('native and fallback retrieval preserve graph and document revision fences', async () => {
  for (const declared of [false, true]) {
    const f = await retrievalFixture({ db: await openTangleDb(declared ? { graphVectors: declaration } : {}) });
    try {
      const rank = createGraphVectorRank(f.db, declaration), native: LightRagStore = { ...f.graph, rankRows: rank.rows };
      assert.deepEqual(await f.retrieve('hybrid', {}, native), await f.retrieve('hybrid'));
      assert.equal(rank.diagnostics().fallback > 0, !declared);
      for (const kind of ['graph', 'document']) {
        let reads = 0;
        const store: LightRagStore = { ...native, listProjections: async filter => {
          const rows = await native.listProjections(filter);
          return kind === 'graph' && ++reads > 1 ? rows.map((row, i) => i ? row : { ...row, head: { ...row.head, revision: row.head.revision + 1 } }) : rows;
        } };
        const counts = new Map<string, number>(), documents = { ...f.documents, getSource: async (id: string) => {
          const row = await f.documents.getSource(id), count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
          return row && kind === 'document' && count > 1 ? { ...row, activeVersionId: 'changed' } : row;
        } };
        const plan = lightragMust(await f.planner(f.control.query, { mode: 'hybrid', limits: f.control.limits }));
        const result = await retrieveLightRag({ store, documents, embedder: f.embedder, plan,
          budget: createBudgetAccount({ turns: 8 }, () => 0), clock: () => 0 });
        assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TLRAG1008');
      }
    } finally { await f.db.close(); }
  }
});
