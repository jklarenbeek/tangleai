import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionSeries } from '@tangleai/memory/place';
import { success, type TemporalStore } from '@tangleai/memory/temporal';
import { placeValue } from './place-fixture.ts';
import { placeHistory, exactPlaceTime } from './place-history.ts';

test('position membership pages to a short third page with numeric table indexes and scoped subjects', async () => {
  const h = await placeHistory([...Array.from({ length: 5 }, (_, i) => ({ time: exactPlaceTime(i) })), { time: exactPlaceTime(99), subject: 'blair' }]);
  const series = placeValue(await positionSeries(h.store, { ...h.seriesOptions, pageLimit: 2 }));
  assert.deepEqual(series.counts, { positions: 5, unplaceable: 0, pages: 3 });
  assert.equal(series.table.length, 5); assert.equal(series.samples.length, 5);
  for (const sample of series.samples) { assert.equal(typeof sample.at, 'number'); assert.equal(sample.at, series.table[sample.value].atEpoch); }
  assert.deepEqual(series.samples.map(row => row.value), [0, 1, 2, 3, 4]);
  assert.ok(Object.isFrozen(series.table[0].claim));
  const limited = await positionSeries(h.store, { ...h.seriesOptions, pageLimit: 2, maxPages: 2 });
  assert.equal(limited.status === 'refused' && limited.code, 'TPLC1011');
});

test('unknown and conflicting assertions remain counted while foreign entry ids refuse', async () => {
  const h = await placeHistory([{ time: { kind: 'unknown' }, status: 'unknown' }, { time: exactPlaceTime(1), status: 'conflicting' }, { time: exactPlaceTime(2) }]);
  const series = placeValue(await positionSeries(h.store, h.seriesOptions));
  assert.deepEqual(series.counts, { positions: 3, unplaceable: 2, pages: 1 });
  assert.equal(series.table.filter(row => row.atEpoch === null).length, 1); assert.equal(series.samples.length, 2);
  const foreign = await placeHistory([{ time: exactPlaceTime(0), value: 'foreign-entry' }]);
  const refused = await positionSeries(foreign.store, foreign.seriesOptions);
  assert.equal(refused.status === 'refused' && refused.code, 'TPLC1004');
});

test('captured inventory rejects shortened pages, duplicate membership and altered numeric mirrors', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }, { time: exactPlaceTime(1) }]);
  for (const change of ['short', 'duplicate', 'mirror', 'version'] as const) {
    const store: TemporalStore = { ...h.store, async queryClaims(query) {
      const rows = placeValue(await h.store.queryClaims(query));
      if (change === 'short') rows.pop();
      if (change === 'duplicate') rows[1] = rows[0];
      if (change === 'mirror') rows[0].validFromEpochMs = 900;
      if (change === 'version') rows[0].versionId = '0'.repeat(64);
      return success(rows);
    } };
    const refused = await positionSeries(store, h.seriesOptions);
    assert.equal(refused.status === 'refused' && refused.code, 'TPLC1009', change);
    assert.equal(refused.status === 'refused' && refused.cause, change === 'short' ? 'incomplete-index' : 'identity-mismatch');
  }
});

test('series reads retain the captured version, validate bounds and preserve thrown storage failures', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }]);
  const stale = await positionSeries(h.store, { ...h.seriesOptions, versionId: '0'.repeat(64) });
  assert.equal(stale.status === 'refused' && stale.cause, 'stale-projection');
  for (const limits of [{ pageLimit: 0 }, { maxPages: Infinity }, { subject: '' }]) {
    const invalid = await positionSeries(h.store, { ...h.seriesOptions, ...limits });
    assert.equal(invalid.status === 'refused' && invalid.code, 'TPLC1001');
  }
  const broken = await positionSeries({ ...h.store, queryClaims: async () => { throw Error('controlled read failure'); } }, h.seriesOptions);
  assert.equal(broken.status === 'refused' && broken.code, 'TPLC1010');
  const forged = await positionSeries({ ...h.store, snapshot: async () => success({ ...h.bundle, head: { ...h.receipt.head, scope: 'foreign' } }) }, h.seriesOptions);
  assert.equal(forged.status === 'refused' && forged.cause, 'stale-projection');
});
