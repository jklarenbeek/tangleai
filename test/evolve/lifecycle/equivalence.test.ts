/**
 * The durable path and the sequential path must agree, row for row.
 *
 * This is the load-bearing test of the whole lifecycle, and it is not
 * about processes. `test/fixtures/evolve-rows.json` pins the sixteen rows
 * the SEQUENTIAL path published — decision, reason, code and the leg
 * census. The durable path reaches those numbers a different way: by
 * walking stages, asking `stageRuns` which of them fire, and adding
 * `legsFor` as each settles.
 *
 * If the two ever disagree, the report's `rows` change and the campaign's
 * oracle stops reproducing — which would show up at the very end of a
 * long regeneration with no diagnostic. Here it shows up as one failing
 * row with its own name.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { legsFor, stageRuns } from '@tangleai/evolve/lifecycle';
import { emptyEnvelope, decide, counted, type EvolveEnvelope } from '@tangleai/evolve/lifecycle';
import { EVOLVE_EFFECT_STAGES } from '@tangleai/evolve/lifecycle';

interface PinnedRow {
  proposalId: string;
  strategyId: string;
  state: string;
  actual: { decision: string, reason: string, code: string | null } | null;
  effects: { legs: number, unresolved: number };
}

const rows: PinnedRow[] = JSON.parse(
  await readFile(new URL('../../fixtures/evolve-rows.json', import.meta.url), 'utf8'),
);

/** The registered sample count, read back out of the pinned census. */
const SAMPLES = 3;
const budgets = { samples: SAMPLES } as never;

/**
 * Put the envelope in the state the row says the run reached.
 *
 * Read from the published decision rather than re-derived, because the
 * point is to check the durable arithmetic against the sequential
 * OUTCOME, not against a second copy of the same reasoning.
 */
function envelopeFor(row: PinnedRow): EvolveEnvelope {
  const base = emptyEnvelope({
    experimentId: 'exp-' + row.proposalId,
    proposalId: row.proposalId,
    strategyId: row.strategyId,
  });
  const actual = row.actual;
  if (actual === null) return base;

  // Refused: nothing ran. This is the nine-row case, and the reason the
  // surface policy is worth having — a goalpost move costs no process.
  if (actual.decision === 'refused') {
    return decide(base, actual as never);
  }

  // Everything else reached the gate. What the gate said is recoverable
  // from the reason the run settled on.
  if (actual.reason === 'red' || actual.reason === 'ambiguous') return { ...base, gate: 'red' };
  if (actual.reason === 'over-budget') return { ...base, gate: 'over-budget' };
  if (actual.reason === 'command') return { ...base, gate: 'command-refused' };
  // improved, equal, regression, unverifiable — all behind a green gate.
  return { ...base, gate: 'green' };
}

/** Walk the stages the way the workflow does, and count what settles. */
function walk(row: PinnedRow): number {
  let env = envelopeFor(row);
  for (const stage of EVOLVE_EFFECT_STAGES) {
    if (!stageRuns(stage, env)) continue;
    env = counted(env, legsFor(stage, budgets));
    // A red gate earns exactly one rerun, and the rerun's verdict is what
    // the row already settled on: red then red, or red then green.
    if (stage === 'gate-rerun') env = { ...env, rerun: env.gate };
  }
  return env.legs;
}

describe('the durable path agrees with the sequential one', () => {
  it('pins all sixteen registered rows', () => {
    assert.equal(rows.length, 16);
    assert.ok(rows.every(row => row.state === 'run'), 'every row ran');
  });

  it('reaches the same leg census for every row', () => {
    const disagreed: string[] = [];
    for (const row of rows) {
      const walked = walk(row);
      if (walked !== row.effects.legs) {
        disagreed.push(`${row.proposalId}: durable ${walked} vs sequential ${row.effects.legs}`);
      }
    }
    assert.deepEqual(disagreed, [],
      'a disagreement here changes the published rows and breaks the oracle');
  });

  it('spends nothing on a refused proposal', () => {
    const refused = rows.filter(row => row.actual?.decision === 'refused');
    assert.equal(refused.length, 9, 'nine of the sixteen are refused before anything runs');
    for (const row of refused) {
      assert.equal(walk(row), 0, `${row.proposalId} reached a process it should not have`);
      assert.equal(row.effects.legs, 0);
    }
  });

  it('spends the full path only behind a green gate', () => {
    // 2 isolate + 1 apply + 1 gate + 3 base + 3 candidate = 10.
    const full = rows.filter(row => row.effects.legs === 10);
    assert.ok(full.length >= 1, 'at least one experiment was measured');
    for (const row of full) {
      assert.ok(['improved', 'equal', 'regression', 'unverifiable'].includes(row.actual!.reason),
        `${row.proposalId} spent a measurement without a green gate`);
      assert.equal(walk(row), 10);
    }
  });

  it('gives a red gate exactly one rerun and no measurement', () => {
    // 2 isolate + 1 apply + 1 gate + 1 rerun = 5. Never 6, and never a
    // measurement: a red gate is already decided.
    const reruns = rows.filter(row => row.effects.legs === 5);
    for (const row of reruns) {
      assert.ok(['red', 'ambiguous'].includes(row.actual!.reason),
        `${row.proposalId} took a rerun without a red gate`);
      assert.equal(walk(row), 5);
    }
  });

  it('stops at the gate when the gate reached no verdict', () => {
    // 2 + 1 + 1 = 4: the gate ran, said nothing usable, and earned no
    // rerun — an over-budget run would only run out of budget again.
    const stopped = rows.filter(row => row.effects.legs === 4);
    for (const row of stopped) {
      assert.ok(['over-budget', 'command'].includes(row.actual!.reason),
        `${row.proposalId} stopped at the gate for the wrong reason`);
      assert.equal(walk(row), 4);
    }
  });

  it('leaves nothing unresolved in the registered pool', () => {
    assert.equal(rows.reduce((sum, row) => sum + row.effects.unresolved, 0), 0);
  });
});
