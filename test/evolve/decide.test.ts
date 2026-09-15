/**
 * The decision table, checked exhaustively and for its two orderings.
 *
 * The exhaustiveness test walks all 200 combinations the input space can
 * express and asserts each lands on a legal decision — no throw, no
 * undefined, no reason outside the vocabulary. A default branch would make
 * that pass trivially, so a separate test proves the two precedences that
 * a default branch would have silently got wrong.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { planExperimentDecision, DECISION_INPUT_SPACE, evolveIssue } from '@tangleai/evolve';
import type { DecisionInput } from '@tangleai/evolve';

const DECISIONS = ['kept', 'abandoned', 'refused', 'uncertain'];
const REASONS = ['improved', 'equal', 'regression', 'red', 'ambiguous', 'over-budget',
  'unverifiable', 'goalpost', 'escape', 'command', 'uncertain-effect'];

describe('the decision planner', () => {
  it('is total: every expressible input lands on exactly one legal decision', () => {
    let seen = 0;
    for (const gate of DECISION_INPUT_SPACE.gate) {
      for (const rerun of DECISION_INPUT_SPACE.rerun) {
        for (const fitness of DECISION_INPUT_SPACE.fitness) {
          for (const unresolvedEffect of DECISION_INPUT_SPACE.unresolvedEffect) {
            const planned = planExperimentDecision({ gate, rerun, fitness, unresolvedEffect });
            const where = JSON.stringify({ gate, rerun, fitness, unresolvedEffect });
            assert.ok(DECISIONS.includes(planned.decision), where + ' → ' + planned.decision);
            assert.ok(REASONS.includes(planned.reason), where + ' → ' + planned.reason);
            assert.ok(planned.code === null || /^TEVO10\d\d$/.test(planned.code), where);
            // Only a keep may have no code, and only a keep may be improved.
            assert.equal(planned.code === null, planned.decision === 'kept', where);
            assert.equal(planned.reason === 'improved', planned.decision === 'kept', where);
            seen++;
          }
        }
      }
    }
    assert.equal(seen, 5 * 5 * 5 * 2, 'the whole space was walked');
  });

  it('lets an unresolved effect outrank every other input', () => {
    // Even a green gate with a clear improvement: the evidence came through
    // a boundary nobody can account for, so nothing is kept and nothing is
    // cleaned up on the strength of it.
    const planned = planExperimentDecision({ gate: 'green', fitness: 'improved', unresolvedEffect: true });
    assert.deepEqual(planned, { decision: 'uncertain', reason: 'uncertain-effect', code: 'TEVO1009' });

    for (const gate of DECISION_INPUT_SPACE.gate) {
      assert.equal(planExperimentDecision({ gate, unresolvedEffect: true }).decision, 'uncertain');
    }
  });

  it('calls a killed or drowned gate over-budget, never red', () => {
    // A gate that never finished reached no verdict, so it earns no rerun
    // and must not be credited with failing the change.
    const overBudget = planExperimentDecision({ gate: 'over-budget' });
    assert.deepEqual(overBudget, { decision: 'abandoned', reason: 'over-budget', code: 'TEVO1005' });

    const refusedCommand = planExperimentDecision({ gate: 'command-refused' });
    assert.deepEqual(refusedCommand, { decision: 'abandoned', reason: 'command', code: 'TEVO1006' });

    // And an over-budget gate is over-budget whatever a rerun would say.
    for (const rerun of DECISION_INPUT_SPACE.rerun) {
      assert.equal(planExperimentDecision({ gate: 'over-budget', rerun }).reason, 'over-budget');
    }
  });

  it('gives red exactly one rerun, and reads its answer as the whole story', () => {
    assert.deepEqual(planExperimentDecision({ gate: 'red', rerun: 'red' }),
      { decision: 'abandoned', reason: 'red', code: 'TEVO1007' });
    assert.deepEqual(planExperimentDecision({ gate: 'red', rerun: 'green' }),
      { decision: 'abandoned', reason: 'ambiguous', code: 'TEVO1008' },
      'red then green is a flake nobody can build on');
    assert.deepEqual(planExperimentDecision({ gate: 'red', rerun: null }),
      { decision: 'abandoned', reason: 'red', code: 'TEVO1007' },
      'a missing rerun cannot become a better outcome');
  });

  it('keeps only a strict improvement behind a green gate', () => {
    assert.deepEqual(planExperimentDecision({ gate: 'green', fitness: 'improved' }),
      { decision: 'kept', reason: 'improved', code: null });
    assert.deepEqual(planExperimentDecision({ gate: 'green', fitness: 'equal' }),
      { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' });
    assert.deepEqual(planExperimentDecision({ gate: 'green', fitness: 'regression' }),
      { decision: 'abandoned', reason: 'regression', code: 'TEVO1008' });
    assert.deepEqual(planExperimentDecision({ gate: 'green', fitness: 'unverifiable' }),
      { decision: 'abandoned', reason: 'unverifiable', code: 'TEVO1008' });
    assert.equal(planExperimentDecision({ gate: 'green', fitness: null }).reason, 'unverifiable',
      'a green gate with no measurement has no evidence either way');
  });

  it('routes an early refusal through the same planner as everything else', () => {
    const goalpost = planExperimentDecision({
      issues: [evolveIssue('TEVO1004', '/patch/0', 'goalpost: test/rank.test.js is protected.')],
    });
    assert.deepEqual(goalpost, { decision: 'refused', reason: 'goalpost', code: 'TEVO1004' });

    const escape = planExperimentDecision({
      issues: [evolveIssue('TEVO1004', '/patch/0', 'escape: a parent-directory component.')],
    });
    assert.deepEqual(escape, { decision: 'refused', reason: 'escape', code: 'TEVO1004' });

    const oversized = planExperimentDecision({
      issues: [evolveIssue('TEVO1005', '/budgets/patchBytes', 'over-budget: 249042 bytes exceeds 8192.')],
    });
    assert.deepEqual(oversized, { decision: 'refused', reason: 'over-budget', code: 'TEVO1005' });

    // A refusal outranks a gate verdict: nothing should have run.
    const both: DecisionInput = {
      issues: [evolveIssue('TEVO1004', '/patch/0', 'goalpost: protected.')],
      gate: 'green', fitness: 'improved',
    };
    assert.equal(planExperimentDecision(both).decision, 'refused');
  });

  it('answers the same input the same way, twice', () => {
    const input: DecisionInput = { gate: 'red', rerun: 'green', fitness: 'improved' };
    assert.deepEqual(planExperimentDecision(input), planExperimentDecision(input));
  });
});
