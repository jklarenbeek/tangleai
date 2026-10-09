import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '@jarenjs/core/random';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { compareLightRagScores, type LightRagRankRequest } from '@tangleai/lightrag';
import { openTangleDb, declareGraphVectors, createGraphVectorRank, GRAPH_VECTOR_STATE_KEY } from '@tangleai/store';

const identity = { model: 'registered-native-64', dims: 64 }, declaration = declareGraphVectors(identity);
const stored = (id: string, embedding: number[] | undefined, embeddedBy = identity, status = 'active') => ({ id,
  sourceId: null, versionId: null, projectionId: null, normalizedName: null, status, sourceEntityId: null, targetEntityId: null,
  payload: { id, embedding, embeddedBy, status } });
it('native graph rank preserves binary ties and exact seeded random scores for both collections and all registered windows', async t => {
  const db = await openTangleDb({ graphVectors: declaration }), random = mulberry32(17753);
  const rows = Array.from({ length: 1000 }, (_, i) => stored('row-' + String(i).padStart(4, '0'), Array.from({ length: 64 }, () => random() * 2 - 1)));
  const probes = Array.from({ length: 20 }, () => Array.from({ length: 64 }, () => random() * 2 - 1));
  let cases = 0;
  try {
    for (const [kind, collection] of [['entity', 'lightrag_entities'], ['relation', 'lightrag_relations']] as const) {
      await db.transaction(async scope => { for (const row of rows) await scope.collection(collection).put(row); });
      const rank = createGraphVectorRank(db, declaration);
      for (const vector of probes) for (const limit of [1, 10, 37, 1000]) {
        const expected = rows.map(row => ({ id: row.id, score: cosineSimilarity(row.payload.embedding!, vector) })).sort(compareLightRagScores).slice(0, limit);
        const actual = (await rank.rank({ kind, identity, vector }, limit))!.map(row => ({ id: row.id, score: cosineSimilarity(row.embedding, vector) }));
        assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id));
        assert.ok(actual.every((row, i) => Object.is(row.score, expected[i].score))); cases++;
      }
      const ordinary = await rank.rank({ kind, identity, vector: probes[0] }, 37);
      const typed = await rank.rank({ kind, identity, vector: new Float64Array(probes[0]) }, 37);
      assert.deepEqual(typed, ordinary);
      const evidence = rank.diagnostics(); assert.equal(evidence.native.queries, 82); assert.equal(evidence.native.diverted, 0);
      assert.equal(evidence.fallback, 0); assert.ok(evidence.native.rows >= 82000); assert.ok(evidence.proofs.length > 0);
    }
    t.diagnostic(JSON.stringify({ records: 1000, probes: 20, windows: [1, 10, 37, 1000], collections: 2, cases, physicalRequests: 0 }));
  } finally { await db.close(); }
});

it('native ranking refuses a changed settled identity and a closed store without reporting empty data', async () => {
  const db = await openTangleDb({ graphVectors: declaration }), rank = createGraphVectorRank(db, declaration);
  const request = { kind: 'entity' as const, identity, vector: [1, ...Array(63).fill(0)] };
  await db.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: { revision: 1, active: { model: 'new-model', dims: 64 }, retained: [] } });
  await assert.rejects(rank.rows(request), { code: 'TVEC1001' }); assert.equal(rank.diagnostics().native.queries, 0);
  await db.close();
  await assert.rejects(rank.rows(request), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'TVEC1002' && error.cause instanceof Error);
  assert.equal(rank.diagnostics().refused, 2); assert.equal(rank.diagnostics().fallback, 0);
});

it('full native candidate reads retain invalid and foreign rejection rows, guard probes, and count unproven fallback', async () => {
  const db = await openTangleDb({ graphVectors: declaration }), absent = await openTangleDb();
  const vector = [1, ...Array(63).fill(0)];
  // Deliberately raw storage corruption qualifies reads, never domain writes.
  const rows = [stored('Z', vector), stored('a', vector), stored('negative', vector.map(x => -x)), stored('zero', Array(64).fill(0)),
    stored('foreign', vector, { model: 'foreign', dims: 64 }), stored('width', [1]), stored('missing', undefined), stored('hidden', vector, identity, 'inactive')];
  try {
    for (const collection of ['lightrag_entities', 'lightrag_relations']) for (const row of rows) await db.collection(collection).put(row);
    for (const kind of ['entity', 'relation'] as const) {
      const rank = createGraphVectorRank(db, declaration), result = (await rank.rows({ kind, identity, vector }))!;
      assert.deepEqual(result.map(row => row.id).sort(), rows.filter(row => row.status === 'active').map(row => row.id).sort());
      assert.equal(rank.diagnostics().unrankable, 3); assert.equal(rank.diagnostics().native.diverted, 0);
      const writes = rank.diagnostics().native.queries;
      await assert.rejects(rank.rows({ kind, identity, vector: [1] }), { code: 'TVEC1001' });
      await assert.rejects(rank.rows({ kind, identity: { ...identity, model: 'wrong' }, vector }), { code: 'TVEC1001' });
      assert.equal(rank.diagnostics().native.queries, writes); assert.equal(rank.diagnostics().refused, 2);
      const fallback = createGraphVectorRank(absent, declaration);
      assert.equal(await fallback.rows({ kind, identity, vector }), null); assert.equal(fallback.diagnostics().fallback, 1);
      assert.equal(fallback.diagnostics().refusals[0].code, 'TVEC1002');
    }
  } finally { await db.close(); await absent.close(); }
});


it('native ranking snapshots the caller request before queued work', async () => {
  const db = await openTangleDb({ graphVectors: declaration }), rank = createGraphVectorRank(db, declaration);
  const probe = [1, ...Array(63).fill(0)];
  const mutations: Array<(request: LightRagRankRequest, vector: number[]) => void> = [
    request => { request.identity.model = 'foreign'; },
    request => { request.identity.dims = 128; },
    request => { request.kind = request.kind === 'entity' ? 'relation' : 'entity'; },
    (_request, vector) => { vector.fill(-1); },
  ];
  try {
    for (const [kind, collection] of [['entity', 'lightrag_entities'], ['relation', 'lightrag_relations']] as const) {
      await db.collection(collection).put(stored(kind + '-registered', probe));
      await db.collection(collection).put(stored(kind + '-opposite', probe.map(value => -value)));
      await db.collection(collection).put(stored(kind + '-foreign', probe, { ...identity, model: 'foreign' }));
    }
    for (const settled of [false, true]) {
      if (settled) await db.collection('settings').put({ key: GRAPH_VECTOR_STATE_KEY, value: { revision: 1, active: identity, retained: [] } });
      for (const kind of ['entity', 'relation'] as const) for (const mutate of mutations) {
        const vector = [...probe], request: LightRagRankRequest = { kind, identity: { ...identity }, vector };
        const pending = rank.rank(request, 1);
        mutate(request, vector);
        assert.deepEqual((await pending)?.map(row => row.id), [kind + '-registered']);
      }
    }
    assert.equal(rank.diagnostics().native.queries, 16);
    assert.equal(rank.diagnostics().refused, 0);
    assert.equal(rank.diagnostics().fallback, 0);
  } finally { await db.close(); }
});
