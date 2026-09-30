import type { HeraIssue } from './contracts.gen.ts';
export type HeraOutcome<T> = { valid: true; value: T } | { valid: false; issues: HeraIssue[] };
export const heraIssue = (code: HeraIssue['code'], path: string, detail: string, cause?: unknown): HeraIssue =>
  ({ code, path, detail, ...(cause === undefined ? {} : { cause }) });
export const heraRefuse = <T = never>(code: HeraIssue['code'], path: string, detail: string, cause?: unknown): HeraOutcome<T> =>
  ({ valid: false, issues: [heraIssue(code, path, detail, cause)] });
/** Internal rollback signal; public content operations return its issues as values. */
export class HeraRefusal extends Error {
  readonly issues: HeraIssue[];
  constructor(issues: HeraIssue[]) { super(issues.map(i => i.detail).join('; ')); this.issues = issues; }
}
