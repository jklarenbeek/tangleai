/**
 * The published single-send measurement holds the guard's promise, and the
 * package README states it.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

it('the published ops-guard run called no single-send operation twice, and gave each requeue exactly one more call', () => {
  const { generated, summary } = JSON.parse(read('benchmark/results/ops-guard.json'));
  assert.ok(generated.kills >= 40 && generated.midCall >= 20);
  assert.equal(summary.pushCalls, summary.pushJobs);
  assert.equal(summary.pushesCalledTwiceBeforeRequeue, 0);
  assert.equal(summary.deadPushesWithNotRepeated, summary.deadPushes);
  assert.equal(summary.requeuedCalledExactlyOnceMore, summary.requeued);
  assert.equal(summary.requeuedCalledMoreThanOnceMore, 0);
  const readme = read('packages/ops/README.md').replace(/\s+/g, ' ');
  assert.ok(readme.includes(`${summary.pushJobs} single-send pushes were called ${summary.pushCalls} times`), 'the README states the run');
});
