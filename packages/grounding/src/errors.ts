import type { GroundingIssue } from './contracts.gen.ts';
export type GroundingOutcome<T> = { valid: true; value: T } | { valid: false; issues: GroundingIssue[] };
export type StoreOutcome<T> = { ok: true; value: T; changes: number } | { ok: false; issue: GroundingIssue };
export function groundingIssue(code: GroundingIssue['code'], path: string, detail: string, cause?: unknown): GroundingIssue {
    const issue: GroundingIssue = { code, path, detail };
    if (cause !== undefined) {
        const origin = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
        issue.cause = {
            code: typeof origin.code === 'string' ? origin.code : 'unknown',
            docPath: typeof origin.docPath === 'string' ? origin.docPath : typeof origin.path === 'string' ? origin.path : '',
            message: typeof origin.message === 'string' ? origin.message : typeof origin.detail === 'string' ? origin.detail : String(cause),
        };
    }
    return issue;
}
export function groundingRefuse<T = never>(code: GroundingIssue['code'], path: string, detail: string, cause?: unknown): GroundingOutcome<T> {
    return { valid: false, issues: [groundingIssue(code, path, detail, cause)] };
}
/** Transaction aborts carry the original value across the persistence boundary. */
export class GroundingAbort extends Error {
    readonly issue: GroundingIssue;
    constructor(issue: GroundingIssue) { super(issue.detail); this.issue = issue; }
}
export function groundingReject(code: GroundingIssue['code'], path: string, detail: string, cause?: unknown): never {
    throw new GroundingAbort(groundingIssue(code, path, detail, cause));
}
export function groundingMust<T>(result: GroundingOutcome<T>): T {
    if (!result.valid) throw new GroundingAbort(result.issues[0]!);
    return result.value;
}
