/**
 * Budgets, and what it means to exhaust one.
 *
 * Every bound an experiment can hit is named here once, so "over budget"
 * is a specific member rather than a mood. `attemptsPerLeg` is fixed at 1
 * by the schema: an effectful leg that failed is never retried, because a
 * process boundary that was lost is not evidence the effect did not
 * happen.
 */

import { checkShape } from './schema.ts';
import { refuseOne, ok, type EvolveOutcome } from './errors.ts';
import type { EvolveBudgets } from './contracts.gen.ts';

/** The budget members an executor can spend against. */
export type BudgetName = keyof EvolveBudgets;

export const BUDGET_NAMES: readonly BudgetName[] = Object.freeze([
  'patchBytes', 'patchFiles', 'attemptsPerLeg', 'calls', 'tokens',
  'legMs', 'experimentMs', 'stdoutBytes', 'stderrBytes', 'workspaceBytes', 'samples',
]);

/**
 * A starting point a host may override wholesale. These are deliberately
 * small: an experiment that needs more says so in its repository record,
 * where the number is reviewable.
 */
export const DEFAULT_EVOLVE_BUDGETS: Readonly<EvolveBudgets> = Object.freeze({
  patchBytes: 65536,
  patchFiles: 16,
  attemptsPerLeg: 1,
  calls: 0,
  tokens: 0,
  legMs: 600000,
  experimentMs: 1800000,
  stdoutBytes: 1048576,
  stderrBytes: 1048576,
  workspaceBytes: 268435456,
  samples: 3,
});

export function checkBudgets(value: unknown, path = ''): EvolveOutcome<EvolveBudgets> {
  return checkShape<EvolveBudgets>('evolveBudgets', value, path);
}

/**
 * Whether one spend fits. Returns the refusal rather than a boolean so the
 * caller records which budget stopped it and by how much.
 */
export function checkBudget(
  budgets: EvolveBudgets,
  name: BudgetName,
  spent: number,
  path = '/budgets',
): EvolveOutcome<number> {
  const limit = budgets[name];
  if (!Number.isFinite(spent) || spent < 0) {
    return refuseOne<number>('TEVO1001', path + '/' + name, 'A spend must be a non-negative finite number.');
  }
  if (spent > limit) {
    return refuseOne<number>('TEVO1005', path + '/' + name,
      'Budget ' + name + ' is ' + limit + '; this run reached ' + spent + '.');
  }
  return ok(spent);
}
