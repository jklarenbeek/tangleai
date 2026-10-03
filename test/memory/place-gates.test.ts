import { it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAuthoredQuery, placeGates, placeIntent } from '@tangleai/memory/place';
import { spatialGates } from '@tangleai/jaren/spatial';
import prefix from '../../benchmark/fixtures/place/refusals/prefix-as-proximity.json' with { type: 'json' };
import planar from '../../benchmark/fixtures/place/refusals/planar-degrees.json' with { type: 'json' };
import noOperator from '../../benchmark/fixtures/place/refusals/no-spatial-operator.json' with { type: 'json' };

const sample = { here: [4.9, 52.3], places: [{ at: [4.91, 52.31], lon: 4.91, lat: 52.31 }] };
const distance = { $jslt: '0.1', rules: [{ match: '$', body: { $for: { c: '$.places[*]' }, $return: { $distance: ['$c.at', '$.here'] } } }] };

it('maps explicit place operations to intent and composes the existing three spatial gates unchanged', () => {
  assert.deepEqual(placeIntent({ kind: 'nearby' }), { proximity: true, spatial: true });
  for (const kind of ['location-at', 'location-at-event', 'movement'] as const) {
    assert.deepEqual(placeIntent({ kind }), { proximity: false, spatial: true });
  }
  const call = { question: 'group by cell', sample, intent: placeIntent({ kind: 'nearby' }) };
  const actual = placeGates(call), native = spatialGates(call);
  assert.equal(actual.length, 3);
  for (const document of [prefix, planar, noOperator, distance]) assert.deepEqual(actual.map(g => g(document)), native.map(g => g(document)));
});

it('counts every recorded refusal with its original cause and accepts native geodesic authoring', () => {
  const call = { question: 'group by cell', sample, intent: placeIntent({ kind: 'nearby' }) };
  for (const [document, code] of [[prefix, 'AI0230'], [planar, 'AI0231'], [noOperator, 'AI0232']] as const) {
    const result = checkAuthoredQuery(document, call);
    assert.equal(result.status === 'refused' && result.code, 'TPLC1007');
    assert.equal(result.status === 'refused' && result.cause, code);
  }
  const passed = checkAuthoredQuery(distance, call);
  assert.equal(passed.status, 'success');
  if (passed.status === 'success') assert.deepEqual(passed.value, distance);
  assert.equal(checkAuthoredQuery(prefix, { ...call, intent: placeIntent({ kind: 'location-at' }) }).status, 'success');
});

it('refuses non-JSON queries, cyclic samples and incomplete explicit intent before walking them', () => {
  const call = { question: 'near here', sample, intent: placeIntent({ kind: 'nearby' }) };
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  for (const result of [checkAuthoredQuery(cyclic, call), checkAuthoredQuery(distance, { ...call, sample: cyclic }),
    checkAuthoredQuery(distance, { ...call, intent: { spatial: true } } as typeof call)]) {
    assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
  }
});
