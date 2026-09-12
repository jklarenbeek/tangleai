/** Pure outcome transition guards; adapters do not define their own state machine. */
import { equalsJson } from '@jarenjs/core/object';
import { issue, reject, OutcomeRefusal } from './errors.ts';
import { scoreUtility } from './domain.ts';
import type { Head, ArtifactVersion, Evaluation, EvaluationRegistration, Approval, Issue } from './outcomes.contracts.gen.ts';
export const EMPTY_HEAD: Readonly<Head> = Object.freeze({ versionId: null, revision: 0 });
export function assertHead(actual: Head, expected: Head): void { if (!equalsJson(actual, expected))
    reject('OUTC1013', 'The expected head version or revision is stale.', '/expectedHead'); }
export function planHeadTransition(actual: Head, expected: Head, target: string): Head { assertHead(actual, expected); return { versionId: target, revision: actual.revision + 1 }; }
export function assertCapacity(retained: number, reserved: number, maximum: number): void { if (retained + reserved >= maximum)
    reject('OUTC1014', 'Artifact version capacity is exhausted.'); }
export function eligibilityIssues(e: Evaluation, r: EvaluationRegistration, v: ArtifactVersion): Issue[] {
    const errors: Issue[] = [...e.issues];
    const add = (detail: string) => errors.push(issue('OUTC1011', detail));
    if (e.versionId !== v.id || r.versionId !== v.id || e.registrationId !== r.id || e.gatePolicyId !== r.gatePolicyId || e.evaluatorRevision !== r.evaluatorRevision || !equalsJson(e.expectedHead, r.expectedHead))
        add('Evaluation identity bindings differ.');
    if (v.issues.length)
        errors.push(...v.issues);
    if (!equalsJson(v.expectedHead, r.expectedHead) || v.parentVersionId !== r.expectedHead.versionId || !equalsJson(e.trainingScoreIds, r.trainingScoreIds))
        add('Parent or training bindings differ.');
    if (!r.cases.length || e.caseResults.length !== r.cases.length || new Set(e.caseResults.map(c => c.id)).size !== r.cases.length || !equalsJson(e.caseResults.map(c => c.id).sort(), r.cases.map(c => c.id).sort()))
        add('Evaluation coverage is incomplete.');
    const n = e.caseResults.length, delta = n ? e.caseResults.reduce((s, c) => s + c.utility - c.baselineUtility, 0) / n : null;
    if (delta === null || delta <= 0 || e.meanDelta !== delta)
        add('Paired held-out utility did not strictly improve.');
    if (e.physicalRequests > r.maxPhysicalRequests)
        add('The registered call bound was exceeded.');
    if (r.maxCost !== null && (e.cost === null || e.cost > r.maxCost))
        add('Known cost within the registered monetary bound is required.');
    if (e.caseResults.some(c => c.utility !== scoreUtility(c.category) || c.baselineUtility !== scoreUtility(c.baselineCategory)))
        add('Case utility differs from its scored category.');
    for (const domain of new Set(r.cases.map(c => c.domain))) {
        const ids = new Set(r.cases.filter(c => c.domain === domain).map(c => c.id));
        if (e.caseResults.filter(c => ids.has(c.id)).reduce((s, c) => s + c.utility - c.baselineUtility, 0) < 0)
            add('A registered domain regressed.');
    }
    return errors;
}
export function planPromotion(actual: Head, v: ArtifactVersion, e: Evaluation, r: EvaluationRegistration, a: Approval): Head {
    if (new Set([v.scopeId, e.scopeId, r.scopeId, a.scopeId]).size !== 1 || new Set([v.artifactKey, e.artifactKey, r.artifactKey, a.artifactKey]).size !== 1)
        reject('OUTC1003', 'Promotion records cross scope or lineage.');
    assertHead(actual, a.expectedHead);
    if (a.action !== 'promote' || a.versionId !== v.id || a.evaluationId !== e.id || a.gatePolicyId !== e.gatePolicyId || !equalsJson(a.expectedHead, e.expectedHead))
        reject('OUTC1012', 'Approval does not bind this promotion.');
    if (v.parentVersionId !== actual.versionId)
        reject('OUTC1013', 'The candidate parent is stale.');
    const issues = eligibilityIssues(e, r, v);
    if (issues.length)
        throw new OutcomeRefusal(issues);
    if (!e.eligible)
        reject('OUTC1011', 'The evaluation is ineligible.');
    return planHeadTransition(actual, a.expectedHead, v.id);
}
