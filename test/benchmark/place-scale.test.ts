import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { measurePlaceScaleShape, placeScaleWorkload } from '../../benchmark/lib/place-scale.ts';
import { PLACE_SCALE_REGISTRATION, readPlaceScaleReceipt, validatePlaceScaleReceipt, placeScaleDecision } from '../../benchmark/lib/place-scale-receipt.ts';
import { createGazetteer } from '@tangleai/memory/place';

test('native physical place trials match the shared sweep and use their real query prefilters', async () => {
  const registration = { ...PLACE_SCALE_REGISTRATION, entries: 16, probes: 3, warmups: 1 };
  const sweep = await measurePlaceScaleShape('sweep', registration, () => performance.now());
  const projected = (worker: typeof sweep) => worker.measurement!.warm.samples.map(({ ms: _ms, ...outcome }) => outcome);
  assert.ok(sweep.measurement);
  for (const shape of ['bbox', 'rtree'] as const) {
    const worker = await measurePlaceScaleShape(shape, registration, () => performance.now());
    assert.equal(worker.workloadId, sweep.workloadId);
    if (!worker.rtree && shape === 'rtree') { assert.equal(worker.measurement, null); assert.match(worker.unavailable!, /rtree=false/); continue; }
    assert.ok(worker.measurement);
    assert.equal(worker.measurement.via, shape === 'bbox' ? 'columns' : 'rtree');
    assert.deepEqual(projected(worker), projected(sweep));
    assert.equal(worker.measurement.cold.samples.length, registration.probes);
  }
});

test('synthetic scale coordinates remain deterministic and are refused by the public sourced gazetteer', async () => {
  const registration = { ...PLACE_SCALE_REGISTRATION, entries: 16, probes: 3, warmups: 1 };
  const workload = await placeScaleWorkload(registration);
  assert.deepEqual(await placeScaleWorkload(registration), workload);
  const entry = workload.entries[0], [lon, lat] = entry.geometry.coordinates;
  const entries = [{ ...entry, names: [entry.id], sourceLatLon: { lon, lat }, confidence: 'exact' }];
  const result = await createGazetteer({ id: 'synthetic-refusal', revision: await canonicalSha256(entries), entries });
  assert.equal(result.status === 'refused' && result.code, 'TPLC1003');
});

test('the frozen scale receipt independently reconciles raw samples, exact outcomes and current source', async () => {
  const receipt = await readPlaceScaleReceipt();
  assert.deepEqual(await validatePlaceScaleReceipt(receipt), receipt);
  assert.deepEqual(placeScaleDecision(receipt.runtimes, receipt.registration.targetP95Ms), { decision: receipt.decision, targetMet: receipt.targetMet });
  for (const mutate of [
    (copy: typeof receipt) => { copy.runtimes[0].rows.sweep!.warm.p95Ms++; },
    (copy: typeof receipt) => { copy.runtimes[0].rows.sweep!.cold.samples.pop(); },
    (copy: typeof receipt) => { copy.runtimes[0].rows.sweep!.warm.samples[0].candidates++; },
    (copy: typeof receipt) => { copy.runtimes[0].rows.sweep!.warm.samples[0].resultSha256 = '0'.repeat(64); },
    (copy: typeof receipt) => { copy.targetMet = !copy.targetMet; },
    (copy: typeof receipt) => { copy.source.files[0].sha256 = '0'.repeat(64); },
  ]) {
    const copy = structuredClone(receipt); mutate(copy); const { sha256: _sha, ...body } = copy; copy.sha256 = await canonicalSha256(body);
    await assert.rejects(validatePlaceScaleReceipt(copy));
  }
});

test('a faster runtime cannot hide a target miss or qualify an unmeasured physical shape', async () => {
  const receipt = await readPlaceScaleReceipt(), runtimes = structuredClone(receipt.runtimes);
  const measured = runtimes.filter(runtime => runtime.status === 'measured');
  for (const runtime of measured) { runtime.rows.bbox = null; runtime.rows.rtree = null; runtime.rows.sweep!.warm.p95Ms = 1; }
  assert.deepEqual(placeScaleDecision(runtimes, 50), { decision: 'sweep', targetMet: true });
  measured.at(-1)!.rows.sweep!.warm.p95Ms = 51;
  assert.deepEqual(placeScaleDecision(runtimes, 50), { decision: 'sweep', targetMet: false });
});
