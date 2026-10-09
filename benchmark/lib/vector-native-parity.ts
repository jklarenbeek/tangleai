/** Native qualification runs real queries over fixed, explicitly synthetic fixtures. */
import assert from 'node:assert/strict';
import { mulberry32 } from '@jarenjs/core/random';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createBudgetAccount } from '@tangleai/agents';
import { openTangleDb, declareGraphVectors, createGraphVectorRank } from '@tangleai/store';
import { compareLightRagScores, createScriptedPlanner, lightragMust, retrieveLightRag } from '@tangleai/lightrag';
import { loadLightRagFixture } from './lightrag.ts';
import { createLightRagLadderCorpus } from './lightrag-ladder-corpus.ts';
import { compareGraphRetrieval, compareRankings, vectorRetrievalEvidence } from './vector-parity.ts';
import registered from '../fixtures/vector/registration.json' with { type: 'json' };

export async function qualifyNativeGraph(root = process.cwd()) {
  const identity = { model: 'hash-trigram-64', dims: 64 }, declaration = declareGraphVectors(identity);
  const db = await openTangleDb({ graphVectors: declaration }), missing = await openTangleDb();
  const random = mulberry32(registered.seed), evidence: unknown[] = [], proofs = new Set<string>();
  let randomCases = 0, goldenCases = 0, typedCases = 0, refusedProbes = 0, fallbackCases = 0, retrievalCases = 0, fenceCases = 0, diverted = 0;
  const raw = (id: string, embedding: number[] | undefined, embeddedBy = identity, status = 'active') => ({ id,
    sourceId: null, versionId: null, projectionId: null, normalizedName: null, status, sourceEntityId: null, targetEntityId: null,
    payload: { id, embedding, embeddedBy, status } });
  const rows = Array.from({ length: registered.nativeRandomRows }, (_, i) => raw('row-' + String(i).padStart(4, '0'), Array.from({ length: 64 }, () => random() * 2 - 1)));
  const probes = Array.from({ length: registered.nativeRandomProbes }, () => Array.from({ length: 64 }, () => random() * 2 - 1));
  try {
    for (const [kind, name] of [['entity', 'lightrag_entities'], ['relation', 'lightrag_relations']] as const) {
      await db.transaction(async scope => { for (const row of rows) await scope.collection(name).put(row); });
      const rank = createGraphVectorRank(db, declaration);
      for (const vector of probes) for (const limit of registered.nativeWindows) {
        const expected = rows.map(row => ({ id: row.id, score: cosineSimilarity(row.payload.embedding!, vector) })).sort(compareLightRagScores).slice(0, limit);
        const actual = (await rank.rank({ kind, identity, vector }, limit))!.map(row => ({ id: row.id, score: cosineSimilarity(row.embedding, vector) }));
        assert.equal(compareRankings({ rows: expected, skipped: {} }, { rows: actual, skipped: {} }).equal, true);
        evidence.push({ kind, limit, rows: actual }); randomCases++;
      }
      for (const vector of [new Float64Array(probes[0]), new Float32Array(probes[0])]) {
        assert.deepEqual(await rank.rank({ kind, identity, vector }, 37), await rank.rank({ kind, identity, vector: Array.from(vector) }, 37)); typedCases++;
      }
      const probe = [1, ...Array(63).fill(0)], golden = [raw('Z', probe), raw('a', probe), raw('negative', probe.map(x => -x)), raw('zero', Array(64).fill(0))];
      await db.transaction(async scope => {
        for (const row of rows) await scope.collection(name).delete(row.id);
        for (const row of golden) await scope.collection(name).put(row);
      });
      for (const limit of [1, 2, 4]) {
        const expected = golden.map(row => ({ id: row.id, score: cosineSimilarity(row.payload.embedding!, probe) })).sort(compareLightRagScores).slice(0, limit);
        const actual = (await rank.rank({ kind, identity, vector: probe }, limit))!.map(row => ({ id: row.id, score: cosineSimilarity(row.embedding, probe) }));
        assert.equal(compareRankings({ rows: expected, skipped: {} }, { rows: actual, skipped: {} }).equal, true); evidence.push({ kind, limit, rows: actual }); goldenCases++;
      }
      // Deliberate persisted corruption exercises guarded reads only.
      for (const row of [raw('foreign', probe, { ...identity, model: 'foreign' }), raw('width', [1]), raw('missing', undefined), raw('hidden', probe, identity, 'inactive')])
        await db.collection(name).put(row);
      const full = (await rank.rows({ kind, identity, vector: probe }))!;
      assert.deepEqual(full.map(row => row.id).sort(), ['Z', 'a', 'foreign', 'missing', 'negative', 'width', 'zero']);
      assert.equal(rank.diagnostics().unrankable, 3); goldenCases++;
      for (const request of [{ kind, identity, vector: [1] }, { kind, identity: { ...identity, model: 'wrong' }, vector: probe }]) {
        await assert.rejects(rank.rows(request), { code: 'TVEC1001' }); refusedProbes++;
      }
      const fallback = createGraphVectorRank(missing, declaration);
      assert.equal(await fallback.rows({ kind, identity, vector: probe }), null); assert.equal(fallback.diagnostics().fallback, 1); fallbackCases++;
      const diagnostics = rank.diagnostics(); diverted += diagnostics.native.diverted;
      assert.equal(diagnostics.fallback, 0); for (const proof of diagnostics.proofs) proofs.add(JSON.stringify(proof));
    }
  } finally { await db.close(); await missing.close(); }
  const graphDb = await openTangleDb({ graphVectors: declaration });
  try {
    const loaded = await loadLightRagFixture(root), corpus = await createLightRagLadderCorpus(loaded, 2, graphDb, () => 0);
    const rank = createGraphVectorRank(graphDb, declaration), native = { ...corpus.graph, rankRows: rank.rows };
    const planner = createScriptedPlanner(loaded.fixture.questions);
    for (const question of loaded.fixture.questions) for (const mode of ['low', 'high', 'hybrid', 'hybrid-no-original'] as const)
      for (const contextTokens of [0, 64, 4000]) {
        const plan = lightragMust(await planner(question.text, { mode, limits: { contextTokens, candidatesPerKeyword: 1, expansionEntities: 1, expansionRelations: 1, chunksPerSource: 1 } }));
        const run = async (store: typeof corpus.graph) => lightragMust(await retrieveLightRag({ store, documents: corpus.documents,
          embedder: corpus.embedder, plan, budget: createBudgetAccount({ turns: 8, tokens: 16000 }, () => 0), clock: () => 0 }));
        const sweep = await run(corpus.graph), actual = await run(native); assert.equal(compareGraphRetrieval(sweep, actual).equal, true);
        evidence.push({ question: question.id, mode, contextTokens, digest: await canonicalSha256(vectorRetrievalEvidence(actual)) }); retrievalCases++;
      }
    for (const fence of ['graph', 'document']) {
      let reads = 0; const counts = new Map<string, number>();
      const store = { ...native, listProjections: async (...args: Parameters<typeof native.listProjections>) => {
        const rows = await native.listProjections(...args);
        return fence === 'graph' && ++reads > 1 ? rows.map(row => ({ ...row, head: { ...row.head, revision: row.head.revision + 1 } })) : rows;
      } };
      const documents = { ...corpus.documents, getSource: async (id: string) => {
        const row = await corpus.documents.getSource(id), count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
        return row && fence === 'document' && count > 1 ? { ...row, activeVersionId: 'changed' } : row;
      } };
      const plan = lightragMust(await planner(loaded.fixture.questions[0].text, { mode: 'hybrid' }));
      const result = await retrieveLightRag({ store, documents, embedder: corpus.embedder, plan, budget: createBudgetAccount({ turns: 8 }, () => 0), clock: () => 0 });
      assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TLRAG1008'); fenceCases++;
    }
    diverted += rank.diagnostics().native.diverted;
    for (const proof of rank.diagnostics().proofs) proofs.add(JSON.stringify(proof));
  } finally { await graphDb.close(); }
  assert.equal(diverted, 0);
  return { randomCases, goldenCases, typedCases, refusedProbes, fallbackCases, retrievalCases, fenceCases, diverted,
    passed: true, digest: await canonicalSha256(evidence), proofs: [...proofs].sort() };
}
