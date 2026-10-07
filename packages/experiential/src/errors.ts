/** Stable refusal values shared by experiential content boundaries. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { CodedError } from '@jarenjs/core/errors';
import type { ExperientialCause, ExperientialIssue } from './contracts.gen.ts';

export const EXPERIENTIAL_ISSUE_CODES = {
  TEXP1001: 'closed schema or shape refused',
  TEXP1002: 'identity or revision mismatch',
  TEXP1003: 'unknown reference',
  TEXP1004: 'incomplete lineage',
  TEXP1005: 'trust, privacy, scope or independence refused',
  TEXP1006: 'invalid lifecycle transition',
  TEXP1007: 'stale head',
  TEXP1008: 'backend capability, receipt or checksum mismatch',
  TEXP1009: 'persistence, budget, cadence or capacity refused',
  TEXP1010: 'registered hard gate failed',
  TEXP1011: 'split or leakage refused',
  TEXP1012: 'retention refused',
} as const;

export type ExperientialIssueCode = keyof typeof EXPERIENTIAL_ISSUE_CODES;
export type ExperientialResult<T> = { ok: true; value: T } | { ok: false; issues: ExperientialIssue[] };

/** Preserve native machine codes without exposing diagnostic text or locations. */
export function experientialNativeCause(error: unknown): ExperientialCause | undefined {
  return error instanceof CodedError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? { code: error.code } : undefined;
}

export function experientialIssue(code: ExperientialIssueCode, path: string, detail: string, cause?: ExperientialCause | ExperientialIssue): ExperientialIssue {
  // A domain wrapper keeps the original cause within the closed cause shape.
  const origin = cause && 'cause' in cause ? cause.cause ?? cause : cause;
  return { code, path, detail, ...(origin === undefined ? {} : { cause: origin }) };
}

export function sortExperientialIssues(issues: readonly ExperientialIssue[]): ExperientialIssue[] {
  const unique = new Map(issues.map(issue => [canonicalizeJson(issue), issue]));
  return [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, issue]) => issue);
}

export function refuseExperiential(code: ExperientialIssueCode, path: string, detail: string, cause?: ExperientialCause): { ok: false; issues: ExperientialIssue[] } {
  return { ok: false, issues: [experientialIssue(code, path, detail, cause)] };
}
