import { it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { matchPlaceMentions, type PlaceMatchOptions, type PlaceMentions } from '@tangleai/memory/place';
import { validateSourceSpan } from '@tangleai/memory/temporal';
import { loadPlaceFixture, type PlaceTurn } from '../../benchmark/lib/place-fixture.ts';
import fixture from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };
import { placeGazetteer, placeSource, placeValue } from './place-fixture.ts';

it('reproduces every sourced mention with exact original spans and deterministic explicit ambiguity', async t => {
  const loaded = await loadPlaceFixture();
  if (loaded.corpus.status !== 'available') { t.skip(loaded.corpus.detail); return; }
  const gazetteer = await placeGazetteer(), counts = { grounded: 0, ambiguous: 0, ungrounded: 0 };
  const addresses = [...new Set(loaded.fixture.mentions.map(m => `${m.sampleId}/${m.diaId}`))];
  for (const [ordinal, address] of addresses.entries()) {
    const turn: PlaceTurn = loaded.corpus.turns.get(address)!;
    const source = await placeSource(turn.text, turn.sampleId, ordinal);
    const annotations = loaded.fixture.mentions.filter(m => `${m.sampleId}/${m.diaId}` === address);
    const qualifications = new Map(annotations.map(m => [`${m.start}:${m.end}`, m.qualification]));
    const options: PlaceMatchOptions = { source, knownUngrounded: loaded.fixture.manifest.knownUngrounded,
      // The audited host supplies locative qualification independently of the
      // matcher. Lexical matching does not infer whether an adjective locates
      // a person; entry ids, ambiguity and question answers are never supplied.
      qualify: (_candidates, context) => qualifications.get(`${context.start}:${context.end}`) !== 'nonlocative-adjective' };
    const actual: PlaceMentions = placeValue(await matchPlaceMentions(turn.text, gazetteer, options));
    assert.equal(canonicalizeJson(await matchPlaceMentions(turn.text, gazetteer, options)), canonicalizeJson({ status: 'success', value: actual }));
    for (const expected of annotations) {
      const mention = actual.mentions.find(m => m.start === expected.start && m.end === expected.end);
      assert.ok(mention, expected.id);
      assert.equal(mention.status, expected.status, expected.id);
      assert.equal(mention.entryId, expected.entryId, expected.id);
      if (expected.status === 'ambiguous') assert.deepEqual(mention.candidates, [...expected.candidates].sort(), expected.id);
      const { entryId: _entry, status: _status, candidates: _candidates, ...span } = mention;
      assert.equal(validateSourceSpan(span, source, source.scope).status, 'success', expected.id);
      counts[mention.status]++;
    }
  }
  assert.deepEqual(counts, { grounded: 174, ambiguous: 10, ungrounded: 13 });
});

it('matches longest aliases at Unicode word boundaries while preserving normalization and original UTF-16 offsets', async () => {
  const entries = structuredClone(fixture.entries.slice(0, 2));
  entries[0].names = ['Café place', 'York', 'ΟΣ', 'İzmir']; entries[1].names = ['New York'];
  const gazetteer = await placeGazetteer(entries);
  const text = '😀 CAFE\u0301\t\nPLACE; New York! Yorks York_1 αYork 𐐀York York𐐀. York, ΟΣ, İZMIR.';
  const source = await placeSource(text), result = placeValue(await matchPlaceMentions(text, gazetteer, { source }));
  assert.deepEqual(result.mentions.map(m => [m.quote, m.entryId]), [
    ['CAFE\u0301\t\nPLACE', entries[0].id], ['New York', entries[1].id], ['York', entries[0].id], ['ΟΣ', entries[0].id], ['İZMIR', entries[0].id],
  ]);
  assert.equal(result.mentions[0].start, 3, 'leading emoji occupies two UTF-16 units');
  for (const { entryId: _entry, status: _status, candidates: _candidates, ...span } of result.mentions) {
    assert.equal(source.text.slice(span.start, span.end), span.quote);
    assert.equal(validateSourceSpan(span, source, source.scope).status, 'success');
  }
  assert.equal(Object.isFrozen(result.mentions), true);
  assert.equal(Object.isFrozen(result.mentions[0].candidates), true);
});

it('retains the candidate inventory after explicit disambiguation and allows context qualification to refuse a lexical match', async () => {
  const entries = structuredClone(fixture.entries.slice(0, 2)); entries.forEach(e => { e.names = ['Shared']; });
  const gazetteer = await placeGazetteer(entries), source = await placeSource('Shared and Nowhere');
  const options = { source, knownUngrounded: ['Nowhere'] };
  const ambiguous = placeValue(await matchPlaceMentions(source.text, gazetteer, options));
  assert.deepEqual(ambiguous.counts, { grounded: 0, ambiguous: 1, ungrounded: 1 });
  const chosen = placeValue(await matchPlaceMentions(source.text, gazetteer, { ...options,
    disambiguate: (candidates, context) => {
      assert.equal(Object.isFrozen(candidates), true); assert.equal(Object.isFrozen(context.source), true);
      assert.equal(context.quote, 'Shared'); return candidates[1].id;
    } }));
  assert.equal(chosen.mentions[0].entryId, entries[1].id);
  assert.deepEqual(chosen.mentions[0].candidates, entries.map(e => e.id));
  const qualified = placeValue(await matchPlaceMentions(source.text, gazetteer, { ...options, qualify: () => false }));
  assert.deepEqual(qualified.counts, { grounded: 0, ambiguous: 0, ungrounded: 2 });
  assert.deepEqual(qualified.mentions[0].candidates, []);
});

it('refuses foreign disambiguation, async or throwing callbacks, malformed aliases and forged sources as values', async () => {
  const entries = structuredClone(fixture.entries.slice(0, 2)); entries.forEach(e => { e.names = ['Shared']; });
  const gazetteer = await placeGazetteer(entries), source = await placeSource('Shared');
  const invalid = [
    { disambiguate: () => 'foreign-id' },
    { disambiguate: () => 1 },
    { disambiguate: async () => entries[0].id },
    { disambiguate: () => Promise.reject(Error('invalid async policy')) },
    { disambiguate: () => { throw Error('host policy failed'); } },
    { qualify: async () => true },
    { qualify: () => 'true' },
    { qualify: () => ({ then() { throw Error('must never await a thenable'); } }) },
    { knownUngrounded: [' '] }, { knownUngrounded: [1] },
  ];
  for (const override of invalid) {
    const result = await matchPlaceMentions(source.text, gazetteer, { source, ...override } as PlaceMatchOptions);
    assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
  }
  const mismatch = await matchPlaceMentions('Other text', gazetteer, { source });
  assert.equal(mismatch.status === 'refused' && mismatch.code, 'TPLC1001');
  const forged = await matchPlaceMentions(source.text, gazetteer, { source: { ...source, sourceHash: '0'.repeat(64) } });
  assert.equal(forged.status === 'refused' && forged.code, 'TPLC1009');
  assert.equal(forged.status === 'refused' && forged.cause, 'identity-mismatch');
});
