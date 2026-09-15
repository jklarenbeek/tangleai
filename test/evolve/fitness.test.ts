/**
 * Fitness, and the check that makes a candidate number mean anything.
 *
 * The drift test is the one to read. A candidate median is only evidence if
 * the BASE still measures what the registration says it measures — so a
 * base that has moved makes the whole run unverifiable, including a run
 * whose candidate looks like a large improvement. That case is asserted
 * explicitly, because it is exactly the one a motivated implementation
 * would be tempted to let through.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSample, summarize, compareFitness, collectSamples } from '@tangleai/evolve';

const metric = { name: 'ndcg' };
const line = (value: number, name = 'ndcg') => JSON.stringify({ metric: name, value });

describe('reading a sample', () => {
  it('takes the last non-empty line, so an instrument may log above its result', () => {
    const stdout = 'warming up\nstill working\n' + line(0.5) + '\n\n';
    const sample = parseSample(stdout, metric);
    assert.equal(sample.ok, true, JSON.stringify(sample));
    assert.deepEqual((sample as { value: unknown }).value, { metric: 'ndcg', value: 0.5 });
  });

  it('refuses a sample it cannot believe, and counts it rather than retrying', () => {
    for (const [stdout, why] of [
      ['', 'nothing printed'],
      ['   \n\n', 'only whitespace'],
      ['not json', 'unparseable'],
      ['[1,2,3]', 'not an object'],
      ['null', 'null'],
      [line(0.5, 'other-metric'), 'a different metric'],
      [JSON.stringify({ metric: 'ndcg', value: 'high' }), 'a non-numeric value'],
      [JSON.stringify({ metric: 'ndcg', value: null }), 'a null value'],
    ] as const) {
      const sample = parseSample(stdout, metric, 2);
      assert.equal(sample.ok, false, why);
      const issue = (sample as { issues: Array<{ code: string, path: string }> }).issues[0];
      assert.equal(issue.code, 'TEVO1008', why);
      assert.equal(issue.path, '/samples/2', 'the refusal names which sample');
    }
  });

  it('refuses a non-finite value, which would poison a median silently', () => {
    for (const raw of ['{"metric":"ndcg","value":1e999}', '{"metric":"ndcg","value":-1e999}']) {
      assert.equal(parseSample(raw, metric).ok, false);
    }
  });

  it('collects a batch and reports how many it refused', () => {
    const collected = collectSamples([line(0.4), 'broken', line(0.6)], metric);
    assert.deepEqual(collected.values, [0.4, 0.6]);
    assert.equal(collected.refused, 1);
    assert.equal(collected.issues[0].path, '/samples/1', 'by index, so a re-read finds it');
  });
});

describe('summarizing a side', () => {
  it('takes the median through the suite statistic, on odd and even counts', () => {
    assert.equal((summarize([3, 1, 2]) as { value: { median: number } }).value.median, 2);
    assert.equal((summarize([4, 1, 2, 3]) as { value: { median: number } }).value.median, 2.5);
    assert.equal((summarize([7]) as { value: { median: number } }).value.median, 7);
  });

  it('keeps the samples it was given, in the order it was given them', () => {
    const summary = summarize([3, 1, 2]) as { value: { samples: number[] } };
    assert.deepEqual(summary.value.samples, [3, 1, 2], 'sorting is the median’s business, not the record’s');
  });

  it('refuses a side with nothing in it', () => {
    const empty = summarize([]);
    assert.equal(empty.ok, false);
    assert.equal((empty as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1008');
  });
});

describe('comparing a candidate against its base', () => {
  const base = { samples: [0.5], median: 0.5 };

  it('reads improvement in the registered direction, whichever way it points', () => {
    const higher = compareFitness({ base, candidate: { samples: [0.7], median: 0.7 }, truth: 0.5, direction: 'higher' });
    assert.equal(higher.comparison, 'improved');
    assert.ok(higher.delta > 0, 'positive delta always means better');

    const lower = compareFitness({ base, candidate: { samples: [0.3], median: 0.3 }, truth: 0.5, direction: 'lower' });
    assert.equal(lower.comparison, 'improved');
    assert.ok(lower.delta > 0);
  });

  it('calls a tie equal, not a generous improvement', () => {
    const tied = compareFitness({ base, candidate: { samples: [0.5], median: 0.5 }, truth: 0.5, direction: 'higher' });
    assert.equal(tied.comparison, 'equal');
    assert.equal(tied.delta, 0);

    // A tie on a `lower` metric multiplies by -1, so the delta arrives as
    // negative zero unless it is normalized — and -0 is not `Object.is`
    // equal to 0, which would make a dead-even result read as some other
    // number than the one it is.
    const tiedLower = compareFitness({
      base: { samples: [3975], median: 3975 }, candidate: { samples: [3975], median: 3975 },
      truth: 3975, direction: 'lower',
    });
    assert.equal(tiedLower.comparison, 'equal');
    assert.equal(tiedLower.delta, 0, 'a tie is zero, never negative zero');
    assert.equal(Object.is(tiedLower.delta, -0), false);
  });

  it('requires movement of at least the registered minimum', () => {
    const marginal = compareFitness({
      base, candidate: { samples: [0.500001], median: 0.500001 },
      truth: 0.5, direction: 'higher', minDelta: 0.01,
    });
    assert.equal(marginal.comparison, 'equal', 'noise is not an improvement');

    const real = compareFitness({
      base, candidate: { samples: [0.6], median: 0.6 },
      truth: 0.5, direction: 'higher', minDelta: 0.01,
    });
    assert.equal(real.comparison, 'improved');
  });

  it('reads movement the wrong way as a regression', () => {
    const worse = compareFitness({ base, candidate: { samples: [0.2], median: 0.2 }, truth: 0.5, direction: 'higher' });
    assert.equal(worse.comparison, 'regression');
    assert.ok(worse.delta < 0);
  });

  it('is unverifiable when the base has drifted, even for a large improvement', () => {
    // The whole point: the candidate looks excellent, and it means nothing,
    // because the base no longer measures what was registered.
    const drifted = compareFitness({
      base: { samples: [0.9], median: 0.9 },
      candidate: { samples: [0.99], median: 0.99 },
      truth: 0.5, direction: 'higher',
    });
    assert.equal(drifted.comparison, 'unverifiable',
      'a flattering number over a moved base is still not evidence');
  });

  it('is unverifiable when any sample was refused', () => {
    const partial = compareFitness({
      base, candidate: { samples: [0.7], median: 0.7 },
      truth: 0.5, direction: 'higher', refused: 1,
    });
    assert.equal(partial.comparison, 'unverifiable', 'a run nobody fully read is not a measurement');
  });

  it('computes the delta once, in the direction’s sign', () => {
    const lower = compareFitness({
      base: { samples: [10], median: 10 }, candidate: { samples: [4], median: 4 },
      truth: 10, direction: 'lower',
    });
    assert.equal(lower.delta, 6, 'six better, expressed positively');

    const higher = compareFitness({
      base: { samples: [10], median: 10 }, candidate: { samples: [4], median: 4 },
      truth: 10, direction: 'higher',
    });
    assert.equal(higher.delta, -6, 'the same movement, now six worse');
  });
});
