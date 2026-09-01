/**
 * The stable MAS refusal vocabulary — values, never throws, for content.
 *
 * `TMAS1xxx` codes are validation/compile refusals over documents;
 * `TMAS2xxx` codes are runtime lifecycle values. Both are pinned by the
 * conformance registration before any implementation: an executor
 * cannot renumber a refusal without failing a registered fixture at its
 * exact code and JSON Pointer. Programmer misuse (a non-object where a
 * document belongs, an unknown enum reached through a cast) may throw;
 * generated or content failure never does.
 */

export const MAS_VALIDATION_CODES = {
  TMAS1001: 'schema/closed-shape invalid',
  TMAS1002: 'duplicate or invalid stable id/version identity',
  TMAS1003: 'unknown/kind-mismatched workflow reference',
  TMAS1004: 'port/message/schema/mapping incompatibility',
  TMAS1005: 'cycle outside a declared loop or unreachable entry/exit',
  TMAS1006: 'invalid switch scope/default/exhaustiveness',
  TMAS1007: 'invalid/unbounded loop or termination query',
  TMAS1008: 'child/fan-out/concurrency/context/budget cap invalid',
  TMAS1009: 'registry, CONFIG, tool or capability request invalid',
  TMAS1010: 'state pull/push scope or mapping invalid',
  TMAS1011: 'a Jaren DAG/FSM/query/JSLT lowering compile refusal',
} as const;

export const MAS_RUNTIME_CODES = {
  TMAS2001: 'immutable version/revision conflict',
  TMAS2002: 'run/executable/registry identity mismatch',
  TMAS2003: 'illegal lifecycle transition',
  TMAS2004: 'node completion payload/message/state validation failed',
  TMAS2005: 'lease/checkpoint ownership lost',
  TMAS2006: 'external success is uncertain',
  TMAS2007: 'interaction conflict/expired/cancelled',
  TMAS2008: 'retention/redaction refusal',
  TMAS2009: 'a runtime budget or limit is exhausted',
} as const;

export type MasValidationCode = keyof typeof MAS_VALIDATION_CODES;
export type MasRuntimeCode = keyof typeof MAS_RUNTIME_CODES;
export type MasCode = MasValidationCode | MasRuntimeCode;

/**
 * One refusal: a stable code, the JSON Pointer of the offending member,
 * and prose. An adapted suite refusal (TMAS1011) retains the Jaren
 * cause's own code, docPath and message as data.
 */
export interface MasIssue {
  code: MasCode;
  path: string;
  detail: string;
  cause?: { code: string, docPath: string, message: string };
}

/** A refusal outcome or a validated, deeply frozen value. */
export type MasValidated<T> = { valid: true, value: T } | { valid: false, issues: MasIssue[] };

export function masIssue(code: MasCode, path: string, detail: string): MasIssue {
  return { code, path, detail };
}

/** Sort refusals by code then pointer so equal inputs produce equal outputs. */
export function sortMasIssues(issues: MasIssue[]): MasIssue[] {
  return issues.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The refusal half of a MasValidated, sorted. */
export function refuse(issues: MasIssue[]): { valid: false, issues: MasIssue[] } {
  return { valid: false, issues: sortMasIssues(issues) };
}
