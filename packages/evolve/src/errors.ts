/**
 * The one evolve refusal vocabulary — values, never throws, for content.
 *
 * The codes are pinned by the adversarial registration the instrument
 * carries, so renumbering one fails a registered expectation at its exact
 * code rather than quietly changing what a refusal means. Programmer
 * misuse may throw; a generated or content failure never does.
 */

import type { EvolveCode, EvolveIssue } from './contracts.gen.ts';

export const EVOLVE_CODES = {
  TEVO1001: 'closed shape / schema invalid',
  TEVO1002: 'identity mismatch',
  TEVO1003: 'repository or write-target refusal',
  TEVO1004: 'mutator-surface violation',
  TEVO1005: 'budget exhausted',
  TEVO1006: 'command refused',
  TEVO1007: 'gate red',
  TEVO1008: 'measurement not accepted',
  TEVO1009: 'effect uncertain',
  TEVO1010: 'lifecycle or authority refusal',
  TEVO1011: 'strategy/outcome binding refusal',
} as const;

export type { EvolveCode, EvolveIssue };

/** A refusal, or a value. Nothing here throws to report content. */
export type EvolveOutcome<T> = { ok: true, value: T } | { ok: false, issues: EvolveIssue[] };

export function evolveIssue(
  code: EvolveCode,
  path: string,
  detail: string,
  cause?: EvolveIssue['cause'],
): EvolveIssue {
  return cause ? { code, path, detail, cause } : { code, path, detail };
}

/** Sort by code then pointer, so equal inputs produce equal refusals. */
export function sortEvolveIssues(issues: EvolveIssue[]): EvolveIssue[] {
  return [...issues].sort((a, b) =>
    (a.code < b.code ? -1 : a.code > b.code ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function refuse<T = never>(issues: EvolveIssue[]): EvolveOutcome<T> {
  return { ok: false, issues: sortEvolveIssues(issues) };
}

export function refuseOne<T = never>(
  code: EvolveCode,
  path: string,
  detail: string,
  cause?: EvolveIssue['cause'],
): EvolveOutcome<T> {
  return refuse<T>([evolveIssue(code, path, detail, cause)]);
}

export function ok<T>(value: T): EvolveOutcome<T> {
  return { ok: true, value };
}
