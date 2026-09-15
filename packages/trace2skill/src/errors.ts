/** Content failures are values. Throwing is reserved for caller bugs. */
import type { Trace2SkillIssue } from './contracts.gen.ts';

export type Trace2SkillCode = Trace2SkillIssue['code'];
export type Trace2SkillOutcome<T> = { valid: true, value: T } | { valid: false, issues: Trace2SkillIssue[] };

/** Originating Jaren/Tangle codes travel as `cause` with their pointers; nothing is renumbered. */
export function trace2SkillIssue(code: Trace2SkillCode, path: string, detail: string, cause?: unknown): Trace2SkillIssue {
  const issue: Trace2SkillIssue = { code, path, detail };
  if (cause !== null && typeof cause === 'object') {
    const origin = cause as { code?: unknown, docPath?: unknown, message?: unknown };
    issue.cause = {
      code: typeof origin.code === 'string' ? origin.code : 'unknown',
      docPath: typeof origin.docPath === 'string' ? origin.docPath : '',
      message: typeof origin.message === 'string' ? origin.message : String(cause),
    };
  }
  return issue;
}

export function trace2SkillRefuse<T = never>(code: Trace2SkillCode, path: string, detail: string, cause?: unknown): Trace2SkillOutcome<T> {
  return { valid: false, issues: [trace2SkillIssue(code, path, detail, cause)] };
}

export function trace2SkillRefusal<T = never>(issues: readonly Trace2SkillIssue[]): Trace2SkillOutcome<T> {
  return { valid: false, issues: [...issues] };
}
