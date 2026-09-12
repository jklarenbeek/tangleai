/** Stable content failures shared by stores, services and wire handlers. */
import type { Issue, Result, Json } from './outcomes.contracts.gen.ts';
export type OutcomeIssue = Issue;
export type OutcomeResult<T extends Json = Json> = {
    ok: true;
    value: T;
    replayed: boolean;
    writes: number;
} | {
    ok: false;
    issues: Issue[];
};
export function issue(code: Issue['code'], detail: string, path = '', retryable = false): Issue { return { code, path, detail, retryable }; }
export const refuse = (code: Issue['code'], detail: string, path = '', retryable = false): OutcomeResult => ({ ok: false, issues: [issue(code, detail, path, retryable)] });
/** Internal transaction abort; caught at the supported content boundary. */
export class OutcomeRefusal extends Error {
    readonly issues: Issue[];
    get code(): Issue['code'] { return this.issues[0].code; }
    get docPath(): string { return this.issues[0].path; }
    constructor(issues: Issue[]) { super(issues[0]?.detail ?? 'outcome refused'); this.issues = issues; }
}
export function reject(code: Issue['code'], detail: string, path = '', retryable = false): never { throw new OutcomeRefusal([issue(code, detail, path, retryable)]); }
export function failure(error: unknown): Result { return error instanceof OutcomeRefusal ? { ok: false, issues: error.issues } : refuse('OUTC1015', 'The storage operation failed before publication.', '', true); }
