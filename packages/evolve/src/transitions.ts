/**
 * The experiment lifecycle, as one pure exhaustive table.
 *
 * `proposed → isolated → applied → gated → measured → decided → recorded`
 * is the only forward path. `abandoned`, `refused`, `uncertain` and
 * `recorded` are terminal and accept nothing — an experiment that stopped
 * cannot be nudged back into motion by a second command, which is what
 * makes a replay of the same command a no-op rather than a second run.
 *
 * Every refusal points at `/status`, because the current status is the
 * thing that made the command illegal.
 */

import { evolveIssue, type EvolveIssue } from './errors.ts';
import type { Status } from './contracts.gen.ts';

/** Every command the lifecycle accepts. There is no merge, push or promote. */
export type ExperimentCommand =
  | 'isolate' | 'apply' | 'gate' | 'measure' | 'decide' | 'record'
  | 'abandon' | 'refuse' | 'uncertain';

export const EXPERIMENT_STATUSES: readonly Status[] = Object.freeze([
  'proposed', 'isolated', 'applied', 'gated', 'measured', 'decided',
  'recorded', 'abandoned', 'refused', 'uncertain',
]);

export const EXPERIMENT_COMMANDS: readonly ExperimentCommand[] = Object.freeze([
  'isolate', 'apply', 'gate', 'measure', 'decide', 'record',
  'abandon', 'refuse', 'uncertain',
]);

/** A status nothing leaves. Listed once, so "terminal" has one definition. */
export const TERMINAL_STATUSES: readonly Status[] = Object.freeze([
  'recorded', 'abandoned', 'refused', 'uncertain',
]);

const RUNNING: readonly Status[] = Object.freeze([
  'proposed', 'isolated', 'applied', 'gated', 'measured', 'decided',
]);

const EXPERIMENT_TRANSITIONS: Record<ExperimentCommand, { from: readonly Status[], to: Status }> = {
  isolate: { from: ['proposed'], to: 'isolated' },
  apply: { from: ['isolated'], to: 'applied' },
  gate: { from: ['applied'], to: 'gated' },
  measure: { from: ['gated'], to: 'measured' },
  decide: { from: ['measured'], to: 'decided' },
  record: { from: ['decided'], to: 'recorded' },
  // A run can stop for one of three reasons from anywhere it is still
  // moving: a counted abandon, a refusal, or an effect nobody can resolve.
  abandon: { from: RUNNING, to: 'abandoned' },
  refuse: { from: RUNNING, to: 'refused' },
  uncertain: { from: RUNNING, to: 'uncertain' },
};

export type ExperimentTransition =
  | { ok: true, status: Status }
  | { ok: false, issue: EvolveIssue };

export function isTerminalStatus(status: Status): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Decide one lifecycle step. Pure: the caller applies it under its own
 * compare-and-swap, so planning and writing stay separable.
 */
export function planExperimentTransition(current: Status, command: ExperimentCommand): ExperimentTransition {
  const rule = EXPERIMENT_TRANSITIONS[command];
  if (rule === undefined) {
    return { ok: false, issue: evolveIssue('TEVO1010', '/status', 'Unknown experiment command: ' + String(command) + '.') };
  }
  if (!rule.from.includes(current)) {
    const why = isTerminalStatus(current)
      ? 'status ' + current + ' is terminal and accepts no command'
      : 'legal from: ' + rule.from.join(', ');
    return {
      ok: false,
      issue: evolveIssue('TEVO1010', '/status',
        'A ' + command + ' transition is illegal from ' + current + ' (' + why + ').'),
    };
  }
  return { ok: true, status: rule.to };
}
