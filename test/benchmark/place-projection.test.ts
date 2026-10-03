import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createTemporalMemoryStore, claimContains } from '@tangleai/memory/temporal';
import { recallByEmbedding } from '@tangleai/memory';
import { buildPlaceProjection } from '../../benchmark/lib/place-projection.ts';
import { loadPlaceFixture } from '../../benchmark/lib/place-fixture.ts';

test('reporting-index projections retain original source precision, unknown residence and exact citations', async t => {
  const loaded = await loadPlaceFixture();
  if (loaded.corpus.status === 'unavailable') { t.skip(loaded.corpus.detail); return; }
  const sample = loaded.corpus.samples.find(s => s.sample_id === 'conv-50')!;
  const make = () => buildPlaceProjection(sample, loaded.fixture.mentions, loaded.fixture.manifest.registration, loaded.fixture.manifest.source.sha256);
  const a = await make(), b = await make();
  assert.equal(canonicalizeJson(a.bundle), canonicalizeJson(b.bundle));
  assert.ok(a.bundle.sources.every(s => s.observedAt.precision === 'minute'));
  const locations = a.bundle.claims.filter(c => c.series.key === 'location');
  const residence = locations.find(c => c.time.kind === 'state')!;
  assert.equal(residence.time.kind, 'state');
  if (residence.time.kind !== 'state') throw new Error('missing residence');
  assert.deepEqual(residence.time.until, { kind: 'unknown' });
  assert.equal(claimContains(residence.time, Date.parse(residence.time.from)).status, 'refused');
  for (const claim of locations) for (const citation of claim.citations) {
    const source = a.bundle.sources.find(s => s.id === citation.sourceId)!;
    assert.equal(source.text.slice(citation.start, citation.end), citation.quote);
    assert.equal(citation.sourceHash, source.sourceHash);
  }
  const store = createTemporalMemoryStore();
  const first = await store.apply(a.bundle, { key: a.replayKey, expectedHead: null }); assert.equal(first.status, 'success');
  const replay = await store.apply(b.bundle, { key: b.replayKey, expectedHead: null }); assert.equal(replay.status, 'success');
  if (replay.status === 'success') { assert.equal(replay.value.writes, 0); assert.equal(replay.value.activations, 0); }
});

test('ordinary score ties follow the shared source-occurrence ordering without losing turn addresses', async () => {
  const built = await buildPlaceProjection({ sample_id: 'ties', qa: [], conversation: {
    speaker_a: 'A', speaker_b: 'B', session_1_date_time: '1:00 pm on 1 May, 2023', session_1: [
      { speaker: 'A', dia_id: 'D1:1', text: 'A repeated observation.' }, { speaker: 'B', dia_id: 'D1:2', text: 'A repeated observation.' },
    ],
  } }, [], { dims: 512 }, 'independent-tie-fixture');
  const ranked = recallByEmbedding(built.units, built.units[0].embedding!, { k: 2, minScore: 0, identity: built.bundle.projection.embeddedBy });
  assert.equal(ranked.ranked[0].score, ranked.ranked[1].score);
  assert.equal(new Set(ranked.ranked.map(r => r.unit.id)).size, 2);
  assert.ok(ranked.ranked.every(r => r.unit.evidence === `ties/${r.unit.id}`));
  const ids = ranked.ranked.map(r => built.sourcesByDiaId.get(r.unit.id)!.id);
  assert.deepEqual(ids, [...ids].sort());
});
