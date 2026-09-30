/** Stable content failures; domain aborts are converted to values at public boundaries. */
import type { ForecastIssue } from './contracts.gen.ts';

export type ForecastCommandResult<T> = { ok: true; value: T; writes: number } | { ok: false; issues: ForecastIssue[] };
export function issue(code: ForecastIssue['code'], detail: string, path = '', retryable = false): ForecastIssue {
  return { code, path, detail, retryable };
}
export function refuse(code: ForecastIssue['code'], detail: string, path = '', retryable = false): ForecastCommandResult<never> {
  return { ok: false, issues: [issue(code, detail, path, retryable)] };
}
export class ForecastRefusal extends Error {
  readonly issues: ForecastIssue[];
  get code() { return this.issues[0].code; }
  constructor(issues: ForecastIssue[], options?: ErrorOptions) {
    super(issues[0]?.detail ?? 'Forecast operation refused.', options);
    this.issues = issues;
  }
}
export function reject(code: ForecastIssue['code'], detail: string, path = '', retryable = false): never {
  throw new ForecastRefusal([issue(code, detail, path, retryable)]);
}
export function failure(error: unknown): ForecastCommandResult<never> {
  return error instanceof ForecastRefusal ? { ok: false, issues: error.issues } : refuse('TFCT1012', 'The host operation failed before publication.', '', true);
}
/** Internal composition preserves the originating domain refusal. */
export function forecastMust<T>(result: ForecastCommandResult<T>): T {
  if (!result.ok) throw new ForecastRefusal(result.issues);
  return result.value;
}
