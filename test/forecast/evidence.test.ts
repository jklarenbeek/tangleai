import { it } from 'node:test';
import assert from 'node:assert/strict';
import { admitEvidence, sha256Bytes, forecastMust } from '@tangleai/forecast';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
import { cutoffAdmits } from '../../benchmark/lib/forecast-oracle.ts';

it('package admission agrees with the benchmark oracle over every fixture snapshot', async () => {
  const fixture = await loadForecastFixtures(); let count = 0;
  for (const q of fixture.questions) for (const c of q.checkpoints) for (const snapshot of fixture.snapshots) {
    const actual = forecastMust(admitEvidence(snapshot,c.cutoffAt)), expected = cutoffAdmits(snapshot,c.cutoffAt);
    assert.deepEqual({ admitted: actual.admitted,reason: actual.reason },expected); count++;
  }
  assert.equal(count,1152);
  assert.equal(admitEvidence({ availableAt: '2025-02-29T00:00:00.000Z' },fixture.questions[0].issuedAt).ok,false);
  assert.equal(await sha256Bytes(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
