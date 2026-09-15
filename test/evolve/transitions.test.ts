/**
 * The lifecycle table, checked exhaustively rather than by example.
 *
 * Every (status, command) pair is visited. A pair is either the one legal
 * target or a refusal at `/status` — there is no third answer, and no pair
 * is left unexercised, so a table edited later cannot grow a hole that
 * happens to sit where no example looked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  planExperimentTransition, isTerminalStatus,
  EXPERIMENT_STATUSES, EXPERIMENT_COMMANDS, TERMINAL_STATUSES,
  type ExperimentCommand,
} from '@tangleai/evolve';
import type { Status } from '@tangleai/evolve/contracts';

/** The one forward path, written out so the test does not share the table's logic. */
const FORWARD: ReadonlyArray<[Status, ExperimentCommand, Status]> = [
  ['proposed', 'isolate', 'isolated'],
  ['isolated', 'apply', 'applied'],
  ['applied', 'gate', 'gated'],
  ['gated', 'measure', 'measured'],
  ['measured', 'decide', 'decided'],
  ['decided', 'record', 'recorded'],
];

const STOPS: ReadonlyArray<[ExperimentCommand, Status]> = [
  ['abandon', 'abandoned'], ['refuse', 'refused'], ['uncertain', 'uncertain'],
];

const legalTarget = (status: Status, command: ExperimentCommand): Status | null => {
  const forward = FORWARD.find(([from, name]) => from === status && name === command);
  if (forward) return forward[2];
  const stop = STOPS.find(([name]) => name === command);
  if (stop && !isTerminalStatus(status)) return stop[1];
  return null;
};

describe('the experiment lifecycle', () => {
  it('answers every status and command pair, and nothing else', () => {
    let legal = 0;
    let refused = 0;
    for (const status of EXPERIMENT_STATUSES) {
      for (const command of EXPERIMENT_COMMANDS) {
        const expected = legalTarget(status, command);
        const planned = planExperimentTransition(status, command);
        if (expected === null) {
          assert.equal(planned.ok, false, status + ' + ' + command + ' must refuse');
          const issue = (planned as { issue: { code: string, path: string } }).issue;
          assert.equal(issue.code, 'TEVO1010');
          assert.equal(issue.path, '/status', 'the current status is what made it illegal');
          refused++;
        }
        else {
          assert.equal(planned.ok, true, status + ' + ' + command + ' must be legal');
          assert.equal((planned as { status: Status }).status, expected);
          legal++;
        }
      }
    }
    assert.equal(legal + refused, EXPERIMENT_STATUSES.length * EXPERIMENT_COMMANDS.length);
    assert.equal(legal, FORWARD.length + STOPS.length * 6, 'six running statuses can stop three ways');
  });

  it('lets nothing out of a terminal status', () => {
    for (const status of TERMINAL_STATUSES) {
      assert.equal(isTerminalStatus(status), true);
      for (const command of EXPERIMENT_COMMANDS) {
        const planned = planExperimentTransition(status, command);
        assert.equal(planned.ok, false, status + ' accepted ' + command);
        assert.match((planned as { issue: { detail: string } }).issue.detail, /terminal/);
      }
    }
  });

  it('names the legal sources when a running status refuses', () => {
    const planned = planExperimentTransition('proposed', 'record');
    assert.equal(planned.ok, false);
    assert.match((planned as { issue: { detail: string } }).issue.detail, /legal from: decided/);
  });

  it('refuses an unknown command rather than throwing', () => {
    const planned = planExperimentTransition('proposed', 'merge' as ExperimentCommand);
    assert.equal(planned.ok, false);
    assert.equal((planned as { issue: { code: string } }).issue.code, 'TEVO1010');
  });
});
