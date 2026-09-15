/**
 * The one decision planner. Pure, total, and without a default branch.
 *
 * Every way an experiment can end is a row in one table, and the table
 * takes RECORDS rather than hosts — so the whole thing is tested without a
 * process, and a row nobody thought to exercise is caught by an
 * exhaustiveness test rather than by a run in production.
 *
 * Two orderings matter and neither is arbitrary.
 *
 * `uncertain` outranks everything. A lost process boundary means the
 * evidence is not trustworthy, so no keep and no cleanup follows from it —
 * the experiment stops and a person looks. Deriving a tidy `abandoned` from
 * untrustworthy evidence would be the most dangerous possible convenience.
 *
 * Over-budget outranks red. A gate killed at its deadline, or drowned in
 * output, did not FAIL — it never finished, and calling that a red result
 * would credit the gate with a verdict it never reached, and would earn a
 * rerun that can only burn the budget again.
 */

import type { Decision, DecisionReason, EvolveCode } from './contracts.gen.ts';
import type { EvolveIssue } from './errors.ts';

/** What the gate said, once its budget questions are settled. */
export type GateVerdict = 'green' | 'red' | 'over-budget' | 'command-refused' | null;

/** What the fitness comparison said, when one ran. */
export type FitnessVerdict = 'improved' | 'equal' | 'regression' | 'unverifiable' | null;

export interface DecisionInput {
  /** Refusals raised before anything ran: proposal shape or immutable surface. */
  issues?: readonly EvolveIssue[];
  /** True when any effect leg ended unresolved. Outranks every other input. */
  unresolvedEffect?: boolean;
  gate?: GateVerdict;
  /** The single permitted rerun, present only when `gate` was red. */
  rerun?: GateVerdict;
  fitness?: FitnessVerdict;
}

export interface PlannedDecision {
  decision: Decision;
  reason: DecisionReason;
  code: EvolveCode | null;
}

const at = (decision: Decision, reason: DecisionReason, code: EvolveCode | null): PlannedDecision =>
  ({ decision, reason, code });

/** The reason an early refusal is, read from the issue that raised it. */
function refusalReason(issue: EvolveIssue): DecisionReason {
  if (issue.detail.startsWith('escape')) return 'escape';
  if (issue.detail.startsWith('over-budget')) return 'over-budget';
  if (issue.detail.startsWith('goalpost')) return 'goalpost';
  // A shape refusal that names no surface rule is still a goalpost in the
  // sense that matters: the proposal was not something this host will run.
  return issue.code === 'TEVO1005' ? 'over-budget' : 'goalpost';
}

/**
 * Decide one experiment. Total over its input: every combination the record
 * schemas can express lands on exactly one row.
 */
export function planExperimentDecision(input: DecisionInput): PlannedDecision {
  // 1. Uncertainty first. Nothing below is trustworthy once a leg is lost.
  if (input.unresolvedEffect === true) return at('uncertain', 'uncertain-effect', 'TEVO1009');

  // 2. Refusals raised before anything ran. The issue's OWN code travels:
  //    a surface violation is TEVO1004, a budget is TEVO1005 and a shape
  //    refusal is TEVO1001, and none of them is rewritten into another.
  const issues = input.issues ?? [];
  if (issues.length > 0) {
    const first = issues[0];
    return at('refused', refusalReason(first), first.code);
  }

  // 3. The gate. Over-budget and a refused command are not verdicts about
  //    the change; they are the run failing to produce one.
  //
  //    Every switch below names `null` explicitly and has no default
  //    branch, so adding a verdict to `GateVerdict` or a comparison to
  //    `FitnessVerdict` fails to compile here instead of falling quietly
  //    into somebody else's row.
  switch (input.gate ?? null) {
    case 'over-budget':
      return at('abandoned', 'over-budget', 'TEVO1005');
    case 'command-refused':
      return at('abandoned', 'command', 'TEVO1006');
    case 'red':
      // Red earns exactly one rerun, and the rerun's answer is the whole
      // story: red again is red, green is a flake nobody can build on.
      switch (input.rerun ?? null) {
        case 'red':
          return at('abandoned', 'red', 'TEVO1007');
        case 'green':
          return at('abandoned', 'ambiguous', 'TEVO1008');
        case 'over-budget':
          return at('abandoned', 'over-budget', 'TEVO1005');
        case 'command-refused':
          return at('abandoned', 'command', 'TEVO1006');
        case null:
          // Red with no rerun recorded is red: the rerun is the mechanism's
          // obligation, and its absence cannot become a better outcome.
          return at('abandoned', 'red', 'TEVO1007');
      }
    // eslint-disable-next-line no-fallthrough
    case null:
      // No gate ran and nothing refused: there is no evidence either way.
      return at('abandoned', 'unverifiable', 'TEVO1008');
    case 'green':
      // 4. Fitness, which only a green gate reaches.
      switch (input.fitness ?? null) {
        case 'improved':
          return at('kept', 'improved', null);
        case 'equal':
          return at('abandoned', 'equal', 'TEVO1008');
        case 'regression':
          return at('abandoned', 'regression', 'TEVO1008');
        case 'unverifiable':
          return at('abandoned', 'unverifiable', 'TEVO1008');
        case null:
          // A green gate with no measurement has no evidence either way.
          return at('abandoned', 'unverifiable', 'TEVO1008');
      }
  }
}

/** Every input combination the planner is total over, for an exhaustiveness test. */
export const DECISION_INPUT_SPACE = Object.freeze({
  gate: Object.freeze(['green', 'red', 'over-budget', 'command-refused', null] as const),
  rerun: Object.freeze(['green', 'red', 'over-budget', 'command-refused', null] as const),
  fitness: Object.freeze(['improved', 'equal', 'regression', 'unverifiable', null] as const),
  unresolvedEffect: Object.freeze([true, false] as const),
});
