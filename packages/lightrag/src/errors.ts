import type { LightRagIssue } from './contracts.gen.ts';
export type LightRagOutcome<T> = { valid: true; value: T } | { valid: false; issues: LightRagIssue[] };
export function lightragRefuse<T = never>(code: LightRagIssue['code'], path: string, detail: string, cause?: unknown): LightRagOutcome<T> {
    const issue: LightRagIssue = { code, path, detail };
    if (cause && typeof cause === 'object') {
        const native = cause as { code?: string; docPath?: string; path?: string; message?: string; detail?: string };
        issue.cause = { code: native.code ?? 'unknown', path: native.docPath ?? native.path ?? '', detail: native.message ?? native.detail ?? String(cause) };
    }
    return { valid: false, issues: [issue] };
}
/** Internal abort unwinds an atomic scope; the supported boundary returns its issues. */
export class LightRagRefusal extends Error {
    readonly issues: LightRagIssue[];
    constructor(issues: LightRagIssue[]) { super(issues[0]?.detail ?? 'Graph operation refused.'); this.issues = issues; }
}
export function lightragMust<T>(outcome: LightRagOutcome<T>): T {
    if (!outcome.valid) throw new LightRagRefusal(outcome.issues);
    return outcome.value;
}
export function lightragReject(code: LightRagIssue['code'], path: string, detail: string, cause?: unknown): never {
    const result = lightragRefuse(code, path, detail, cause);
    if (!result.valid) throw new LightRagRefusal(result.issues);
    throw new TypeError('Refusal factory returned success.');
}
export function lightragFailure<T = never>(cause: unknown): LightRagOutcome<T> {
    return cause instanceof LightRagRefusal ? { valid: false, issues: cause.issues }
        : lightragRefuse('TLRAG1010', '', 'The host could not complete the graph operation.', cause);
}
