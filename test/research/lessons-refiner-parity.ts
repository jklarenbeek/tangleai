import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createLessonRefiner, type ResearchStore } from '@tangleai/research';
import { stored } from './store-harness.ts';
import { validatedCorrectionFixture } from './lessons-refiner-fixtures.ts';

export interface LessonRefinerHarness {
  store: ResearchStore;
  capture(): Promise<unknown>;
  close(): Promise<void>;
  arm(boundary: number | null): void;
  steps(): string[];
}
export async function runLessonRefinerParity(open: () => Promise<LessonRefinerHarness>) {
  let digest = '', steps: string[] = [];
  const first = await open();
  try {
    const f = await validatedCorrectionFixture(first.store); first.arm(null);
    const committed = stored(await f.refiner.commit(f.request)); steps = first.steps(); digest = await canonicalSha256(committed);
    const before = await first.capture(); first.arm(null);
    const replay = await createLessonRefiner({ ...f.options, now: () => '2027-01-01T00:00:00.000Z' }).commit(f.request);
    assert.ok(replay.ok); assert.equal(replay.replayed, true); assert.deepEqual(replay.value, committed);
    assert.equal(first.steps().filter(step => step.includes('put:')).length, 0); assert.deepEqual(await first.capture(), before);
  } finally { await first.close(); }
  const failures = steps.map((step, i) => ({ step, boundary: i + 1 })).filter(row => row.step.includes('put:') || row.boundary === steps.length);
  for (const { step, boundary } of failures) {
    const h = await open();
    try {
      const f = await validatedCorrectionFixture(h.store), before = await h.capture(); h.arm(boundary);
      const refused = await f.refiner.commit(f.request); assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.issue.code, 'TRSH1008');
      assert.equal(h.steps().at(-1), step); assert.deepEqual(await h.capture(), before);
    } finally { await h.close(); }
  }
  const h = await open();
  try {
    const f = await validatedCorrectionFixture(h.store);
    const results = await Promise.all(Array.from({ length: 20 }, () => createLessonRefiner(f.options).commit(f.request)));
    assert.ok(results.every(row => row.ok), JSON.stringify(results)); assert.equal(results.filter(row => row.ok && !row.replayed).length, 1);
    for (const result of results) assert.equal(await canonicalSha256(stored(result)), digest);
  } finally { await h.close(); }
  return { stateDigest: digest, faultBoundaries: failures.map(row => row.step), concurrent: { applied: 1, replayed: 19 }, physicalRequests: 0 };
}
