/**
 * Failures read as evidence, and the one threshold that makes them mean
 * anything.
 *
 * The test that carries this file is the pair at the bottom: the same
 * number of failures, arranged two ways. Five failures from five distinct
 * proposals is evidence about the mechanism; five failures from one
 * proposal is evidence about that proposal. A layer that counted failures
 * without asking how many distinct instances produced them would score
 * those two identically — and a mechanism built on that count would bend
 * itself around whichever instance happened to fail loudest.
 *
 * `compareRounds` rejecting a tie is asserted for the same reason: equal
 * evidence is not a reason to move, and keeping the incumbent is the
 * cheaper error.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateFailures, groupFailures, failureRecordOf, mechanismOf, roundScore,
  compareRounds, SYSTEMATIC_THRESHOLD, FAILURE_MECHANISMS,
} from '@tangleai/evolve';
import type { DecidedRow, FailureRecord } from '@tangleai/evolve';
import type { DecisionReason } from '@tangleai/evolve/contracts';

const ALL_REASONS: DecisionReason[] = [
  'improved', 'equal', 'regression', 'red', 'ambiguous', 'over-budget',
  'unverifiable', 'goalpost', 'escape', 'command', 'uncertain-effect',
];

const row = (
  proposalId: string, strategyId: string,
  actual: DecidedRow['actual'], state = 'run',
): DecidedRow => ({ proposalId, strategyId, state, actual });

const failed = (proposalId: string, strategyId: string, reason: DecisionReason): DecidedRow =>
  row(proposalId, strategyId, { decision: 'abandoned', reason, code: 'TEVO1008' });

describe('which mechanism a failure indicts', () => {
  it('is total over the reason vocabulary, and only a keep is not a failure', () => {
    for (const reason of ALL_REASONS) {
      const mechanism = mechanismOf(reason);
      if (reason === 'improved') {
        assert.equal(mechanism, null, 'an improvement indicts nothing');
        continue;
      }
      assert.ok(mechanism !== null, reason + ' must name a mechanism');
      assert.ok(FAILURE_MECHANISMS.includes(mechanism), reason + ' → ' + mechanism);
    }
  });

  it('files a refused surface and a blown budget apart', () => {
    assert.equal(mechanismOf('goalpost'), 'surface');
    assert.equal(mechanismOf('escape'), 'surface');
    assert.equal(mechanismOf('over-budget'), 'budget');
    assert.equal(mechanismOf('red'), 'gate');
    assert.equal(mechanismOf('ambiguous'), 'gate');
    assert.equal(mechanismOf('equal'), 'measurement');
    assert.equal(mechanismOf('uncertain-effect'), 'effect');
  });
});

describe('reading one row as a failure record', () => {
  it('ignores a keep, an unrun row and a row with no decision', () => {
    assert.equal(failureRecordOf(row('a', 'S', { decision: 'kept', reason: 'improved', code: null })), null);
    assert.equal(failureRecordOf(row('b', 'S', null, 'implementation-missing')), null);
    assert.equal(failureRecordOf(row('c', 'S', null)), null);
  });

  it('keeps what makes a failure comparable with another failure', () => {
    const record = failureRecordOf(row('edit-ci-workflow', 'S-goalpost', {
      decision: 'refused', reason: 'goalpost', code: 'TEVO1004',
    }));
    assert.deepEqual(record, {
      instanceId: 'edit-ci-workflow',
      cohortId: 'S-goalpost',
      decision: 'refused',
      reason: 'goalpost',
      code: 'TEVO1004',
      mechanism: 'surface',
    });
  });
});

describe('grouping failures into patterns', () => {
  const records = [
    failed('p1', 'S-a', 'goalpost'), failed('p2', 'S-a', 'goalpost'), failed('p3', 'S-b', 'escape'),
    failed('p4', 'S-c', 'red'),
  ].map(failureRecordOf).filter((one): one is FailureRecord => one !== null);

  it('marks a pattern systematic only when distinct instances recur', () => {
    const byReason = groupFailures(records, 'reason');
    const goalpost = byReason.find(one => one.name === 'goalpost');
    const escape = byReason.find(one => one.name === 'escape');

    assert.equal(goalpost?.evidence, 'systematic', 'two distinct proposals is evidence about the mechanism');
    assert.deepEqual(goalpost?.instances, ['p1', 'p2']);
    assert.equal(escape?.evidence, 'incidental', 'one proposal is evidence about that proposal');
    assert.equal(SYSTEMATIC_THRESHOLD, 2, 'the threshold is stated, not buried');
  });

  it('rolls reasons up into the mechanism they share', () => {
    const byMechanism = groupFailures(records, 'mechanism');
    const surface = byMechanism.find(one => one.name === 'surface');
    // `goalpost` alone recurs, but `escape` joins it at the coarser view —
    // three distinct proposals all indicting the same stage.
    assert.equal(surface?.failures, 3);
    assert.deepEqual(surface?.instances, ['p1', 'p2', 'p3']);
    assert.deepEqual(surface?.cohorts, ['S-a', 'S-b']);
    assert.equal(surface?.evidence, 'systematic');
  });

  it('answers the same groups in the same order, twice', () => {
    assert.deepEqual(groupFailures(records, 'reason'), groupFailures(records, 'reason'));
    assert.deepEqual(
      groupFailures(records, 'mechanism').map(one => one.name),
      [...groupFailures(records, 'mechanism').map(one => one.name)].sort(),
      'patterns are published in a stable order');
  });

  it('counts an instance once however many times it failed the same way', () => {
    const repeated = [failed('p1', 'S-a', 'red'), failed('p1', 'S-a', 'red')]
      .map(failureRecordOf).filter((one): one is FailureRecord => one !== null);
    const pattern = groupFailures(repeated, 'reason')[0];
    assert.equal(pattern.failures, 2, 'both failures are counted');
    assert.deepEqual(pattern.instances, ['p1'], 'but they came from one instance');
    assert.equal(pattern.evidence, 'incidental', 'so they are not evidence about the mechanism');
  });
});

describe('what a round of verdicts amounts to', () => {
  it('separates evidence about the mechanism from evidence about an instance', () => {
    // The whole point, stated twice with the same failure count.
    const spread = aggregateFailures([
      failed('p1', 'S-a', 'goalpost'), failed('p2', 'S-b', 'goalpost'),
      failed('p3', 'S-c', 'goalpost'), failed('p4', 'S-d', 'goalpost'),
      failed('p5', 'S-e', 'goalpost'),
    ]);
    const narrow = aggregateFailures([
      failed('p1', 'S-a', 'goalpost'), failed('p1', 'S-a', 'red'),
      failed('p1', 'S-a', 'equal'), failed('p1', 'S-a', 'command'),
      failed('p1', 'S-a', 'uncertain-effect'),
    ]);

    assert.equal(spread.failures, narrow.failures, 'the same number of failures');
    assert.equal(spread.systematicRatio, 1, 'five distinct proposals indicting one stage');
    assert.equal(narrow.systematicRatio, 0, 'one proposal failing five ways indicts nothing');
  });

  it('reconciles: every failure is systematic or incidental, never both', () => {
    const evidence = aggregateFailures([
      failed('p1', 'S-a', 'goalpost'), failed('p2', 'S-a', 'goalpost'),
      failed('p3', 'S-b', 'red'), failed('p4', 'S-c', 'equal'),
      row('p5', 'S-d', { decision: 'kept', reason: 'improved', code: null }),
    ]);
    assert.equal(evidence.failures, 4, 'the keep is not a failure');
    assert.equal(evidence.systematic + evidence.incidental, evidence.failures);
    assert.equal(evidence.systematic, 2, 'only the recurring surface pattern');
    assert.equal(evidence.systematicRatio, 0.5);
  });

  it('says nothing rather than dividing by nothing when nothing failed', () => {
    const clean = aggregateFailures([row('p1', 'S-a', { decision: 'kept', reason: 'improved', code: null })]);
    assert.equal(clean.failures, 0);
    assert.equal(clean.systematicRatio, 0);
    assert.deepEqual(clean.mechanisms, []);
  });
});

describe('the aggregate score, and what it accepts', () => {
  it('scores the round rather than any instance in it', () => {
    const score = roundScore([
      row('p1', 'S-a', { decision: 'kept', reason: 'improved', code: null }),
      failed('p2', 'S-b', 'equal'),
      failed('p3', 'S-c', 'red'),
      row('p4', 'S-d', null, 'implementation-missing'),
    ]);
    assert.deepEqual(score, { attempted: 3, kept: 1, value: 1 / 3 },
      'an unrun row is not an attempt');
  });

  it('accepts only a strict improvement of the whole round', () => {
    const previous = { attempted: 16, kept: 1, value: 1 / 16 };
    assert.equal(compareRounds(previous, { attempted: 16, kept: 2, value: 2 / 16 }), 'accept');
    assert.equal(compareRounds(previous, { attempted: 16, kept: 0, value: 0 }), 'reject');
  });

  it('rejects a tie, because equal evidence is not a reason to move', () => {
    const score = { attempted: 16, kept: 1, value: 1 / 16 };
    assert.equal(compareRounds(score, { ...score }), 'reject');
  });

  it('rejects a round of a different size, in either direction', () => {
    // The goalpost move that arrives through the scoreboard instead of
    // through a patch. An experiment that never ran is not an attempt, so
    // the count moves the ratio on its own: dropping the hard proposals
    // raises it, and so does bolting trivial ones on. Neither fixed
    // anything, and the registration is immutable, so a legitimate round
    // always attempts the same count.
    const previous = { attempted: 16, kept: 1, value: 1 / 16 };
    assert.equal(compareRounds(previous, { attempted: 1, kept: 1, value: 1 }), 'reject',
      'shrinking the round is not improving the mechanism');
    assert.equal(compareRounds(previous, { attempted: 15, kept: 15, value: 1 }), 'reject',
      'one unanswered experiment is enough to make the scores incomparable');
    assert.equal(compareRounds(previous, { attempted: 26, kept: 11, value: 11 / 26 }), 'reject',
      'padding the round with easy instances is the same move, inverted');
  });

  it('accepts a strict improvement over a round of the same size', () => {
    const previous = { attempted: 16, kept: 1, value: 1 / 16 };
    assert.equal(compareRounds(previous, { attempted: 16, kept: 2, value: 2 / 16 }), 'accept');
  });

  it('rejects a candidate that trades one gain for two losses', () => {
    // The failure mode per-instance acceptance cannot see: a change that
    // fixes the case in front of it and quietly breaks others.
    const previous = roundScore([
      row('p1', 'S', { decision: 'kept', reason: 'improved', code: null }),
      row('p2', 'S', { decision: 'kept', reason: 'improved', code: null }),
      row('p3', 'S', { decision: 'kept', reason: 'improved', code: null }),
      failed('p4', 'S', 'equal'),
    ]);
    const candidate = roundScore([
      row('p1', 'S', { decision: 'kept', reason: 'improved', code: null }),
      failed('p2', 'S', 'regression'),
      failed('p3', 'S', 'regression'),
      row('p4', 'S', { decision: 'kept', reason: 'improved', code: null }),
    ]);
    assert.equal(compareRounds(previous, candidate), 'reject',
      'one new keep does not pay for two lost ones');
  });
});
