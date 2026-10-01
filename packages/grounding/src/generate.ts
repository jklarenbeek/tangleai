/** Claims, bounded reference repair and durable answer records; no free-prose response channel. */
import type { DocumentCorpusStore } from '@tangleai/documents/contracts';
import { MasBudgetStop } from '@tangleai/mas';
import { equalsJson } from '@jarenjs/core/object';
import { unfence } from '@tangleai/models/structured';
import type { EvidenceCandidate, EvidenceConflict, GroundedAnswer, GroundingIssue, PrihaAnswer, QueryPlan } from './contracts.gen.ts';
import type { GroundingStore } from './store.ts';
import { createAnswerModel, type AnswerModelOptions } from './answer-model.ts';
import { interpretEvidenceConflicts } from './reconcile-model.ts';
import { createCitationResolver, repairPrihaClaims, validatePrihaClaims } from './validate.ts';
import { evaluateProfileRules } from './profile.ts';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { groundingIdOf, groundingRevisionOf, immutableGroundingJson } from './identity.ts';
import { GroundingAbort, groundingIssue, groundingMust, groundingReject } from './errors.ts';
import { validateGroundingShape } from './schema.ts';
export interface GenerateGroundedClaimsOptions extends AnswerModelOptions {
    sessionId: string; query: string; plan: QueryPlan; admitted: readonly EvidenceCandidate[]; conflicts: readonly EvidenceConflict[];
    store: GroundingStore; corpus?: DocumentCorpusStore; expectedRevision?: number;
    /** Host policy can strengthen every claim; model replies cannot weaken this declaration. */
    critical?: boolean;
    /** A preceding native workflow stage can retain the bounded interpretation. */
    interpretConflicts?: boolean;
    /** A durable host distinguishes unavailable dependencies from unsupported claims. */
    failOnDependencyError?: boolean;
}
export async function generateGroundedClaims(options: GenerateGroundedClaimsOptions) {
    options = { ...options, profile: immutableGroundingJson(options.profile), modelIdentity: immutableGroundingJson(options.modelIdentity),
        plan: immutableGroundingJson(options.plan), admitted: immutableGroundingJson(options.admitted), conflicts: immutableGroundingJson(options.conflicts),
        ...(options.budget ? { budget: immutableGroundingJson(options.budget) } : {}) };
    const model = await createAnswerModel(options), query = options.query, critical = options.critical ?? false;
    const plan = groundingMust(validateGroundingShape('queryPlan', options.plan)), admitted = immutableGroundingJson(options.admitted);
    const sessionId = options.sessionId, store = options.store, expectedRevision = options.expectedRevision;
    let conflicts = immutableGroundingJson(options.conflicts), repairs = 0, stopReason = 'answered', removedClaimIds: string[] = [];
    const validationIssues: GroundingIssue[] = [];
    const refusal = (reason: string): PrihaAnswer => ({ disposition: 'refuse', reason, claims: [] });
    let accepted = false;
    let draft: PrihaAnswer = refusal('The available evidence does not support a reliable answer.');
    try {
        const session = await store.getSession(sessionId), trace = await store.readTrace(sessionId);
        if (!session || !trace || session.profileRevision !== model.profile.revision || session.planId !== plan.id
            || !trace.plans.some(row => row.id === plan.id && equalsJson(row, plan)))
            groundingReject('TGRD1004', '/plan', 'Generation requires the retained plan of this profile and session.');
        if (session.status !== 'generating') groundingReject('TGRD1003', '/status', 'The session is not ready to generate an answer.');
        if (expectedRevision !== undefined && session.revision !== expectedRevision) groundingReject('TGRD1002', '/revision', 'The generation session revision changed.');
        if (trace.intents.find(intent => intent.id === plan.intentId)?.originalQuery !== query)
            groundingReject('TGRD1004', '/query', 'Generation must preserve the original retained user turn.');
        for (const row of admitted) if (row.sessionId !== sessionId || row.profileRevision !== model.profile.revision
            || !plan.queries.some(item => item.id === row.queryId) || !trace.evidence.some(retained => retained.id === row.id && equalsJson(retained, row)))
            groundingReject('TGRD1004', '/evidence', 'Generation evidence differs from its retained session record.');
        for (const conflict of conflicts) if (conflict.sessionId !== sessionId || conflict.evidenceIds.some(id => !trace.evidence.some(row => row.id === id)))
            groundingReject('TGRD1004', '/conflicts', 'A conflict belongs to foreign or missing evidence.');
        for (const conflict of conflicts) {
            groundingMust(validateGroundingShape('evidenceConflict', conflict));
            if (conflict.excludedEvidenceIds?.some(id => admitted.some(row => row.id === id)))
                groundingReject('TGRD1008', '/admitted', 'Rule-excluded evidence cannot return to generation.');
        }
        accepted = true;
        const rules = evaluateProfileRules(model.profile, { text: query });
        if (rules.emergency || rules.outOfScope || options.interpretConflicts === false) {
            const stored = await store.putConflict([...conflicts]);
            if (!stored.ok) groundingReject(stored.issue.code, stored.issue.path, stored.issue.detail);
        } else {
            const interpreted = await interpretEvidenceConflicts({ model, query, admitted, conflicts, store }); conflicts = interpreted.conflicts;
        }
        const criticalConflict = conflicts.some(row => row.issue === 'official-vs-official' && (row.decision === 'refuse' || row.decision === 'unresolved' && row.severity === 'critical'));
        if (rules.emergency || rules.outOfScope) {
            draft = refusal(rules.emergency ? 'This request needs the emergency route specified by the service.' : 'This request is outside the supported information service.');
            stopReason = rules.emergency ?? rules.outOfScope!;
        } else if (criticalConflict) { draft = refusal('The official sources disagree on a critical fact.'); stopReason = 'critical-conflict'; }
        else if (!admitted.length) { draft = { disposition: 'abstain', reason: 'The admitted evidence does not answer this question.', claims: [] }; stopReason = 'no-evidence'; }
        else {
            const resolver = await createCitationResolver(admitted, options.corpus), view = resolver.view;
            const gate = (value: PrihaAnswer) => {
                const checked = validatePrihaClaims(value, view);
                if (value.disposition === 'answer') value.claims.forEach((claim, index) => {
                    if (!claim.citations.length) checked.errors.push({ code: 'EVIDENCE_REFERENCE', docPath: `/claims/${index}/citations`, instancePath: `/claims/${index}/citations`, message: 'Every factual claim requires admitted evidence.' });
                });
                if (critical && value.disposition === 'answer') value.claims.forEach((claim, index) => {
                    if (!claim.critical) checked.errors.push({ code: 'EVIDENCE_CRITICAL', docPath: `/claims/${index}/critical`, instancePath: `/claims/${index}/critical`, message: 'Host criticality cannot be weakened.' });
                });
                return { valid: checked.valid && checked.errors.length === 0, errors: checked.errors };
            };
            // Reference errors use the guarded patch path below, sharing the same single repair ceiling.
            const generated = await model.run('generate', query, admitted, { plan, conflicts, critical }, { maxRepairs: 0, gate });
            if (generated.errors) {
                let parsed: unknown;
                try { parsed = JSON.parse(unfence(generated.raw)); } catch { /* No schema-valid draft can be patched. */ }
                const shape = validateGroundingShape('prihaAnswer', parsed);
                if (!shape.valid) {
                    if (!model.repairs) groundingReject('TGRD1008', '/claims', 'The generated claim ledger was invalid.');
                    repairs++;
                    const retried = await model.run('generate', query, admitted, { plan, conflicts, critical, errors: generated.errors }, { maxRepairs: 0, gate });
                    if (retried.errors) groundingReject('TGRD1008', '/claims', 'The claim ledger remained invalid after its one repair.', { code: 'structured-output', message: JSON.stringify(retried.errors) });
                    draft = retried.value as PrihaAnswer;
                } else {
                    draft = shape.value;
                    if (model.repairs) {
                        repairs++;
                        const proposed = await model.run('repair', query, admitted, { draft, errors: gate(draft).errors }, { maxRepairs: 0 });
                        if (!proposed.errors) {
                            const fixed = await repairPrihaClaims(draft, view, proposed.value);
                            if (fixed.ok && gate(fixed.value).valid) {
                                const survivors = new Set(fixed.value.disposition === 'answer' ? fixed.value.claims.map(claim => claim.id) : []);
                                removedClaimIds = draft.disposition === 'answer' ? draft.claims.filter(claim => !survivors.has(claim.id)).map(claim => claim.id) : [];
                                draft = fixed.value;
                            }
                        }
                    }
                    // Fail closed for the complete ledger when its bounded repair cannot prove references.
                    if (!gate(draft).valid) groundingReject('TGRD1008', '/claims', 'The claims could not be validated within the repair budget.', { ...gate(draft).errors[0], message: JSON.stringify(gate(draft).errors) });
                }
            } else draft = generated.value as PrihaAnswer;
            if (draft.disposition === 'answer') for (const claim of draft.claims) for (const id of claim.citations) groundingMust(resolver.resolve(id));
            stopReason = draft.disposition === 'answer' ? 'answered' : draft.disposition === 'refuse' ? 'unsupported-claims' : 'insufficient-evidence';
        }
    } catch (cause) {
        if (options.failOnDependencyError && !(cause instanceof MasBudgetStop) && (!(cause instanceof GroundingAbort) || cause.issue.code === 'TGRD1009'))
            return { ok: false as const, issue: cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/generation', 'The generation dependency failed.', cause) };
        const issue = cause instanceof GroundingAbort ? cause.issue : cause instanceof MasBudgetStop ? groundingIssue('TGRD1007', '/budget', cause.reason, cause) : groundingIssue('TGRD1008', '/generation', 'Grounded generation could not complete.', cause);
        if (!accepted) return { ok: false as const, issue };
        validationIssues.push(issue); draft = refusal('The available evidence could not be validated for a reliable answer.');
        stopReason = typeof (cause as { reason?: unknown })?.reason === 'string' ? (cause as { reason: string }).reason : issue.code === 'TGRD1008' ? 'unsupported-claims' : 'generation-failed';
    }
    const claims: GroundedAnswer['claims'] = draft.disposition === 'answer' ? draft.claims.map(claim => {
        const related = conflicts.filter(conflict => conflict.evidenceIds.some(id => claim.citations.includes(id)));
        const caveats = [...new Set([...claim.caveats, ...related.filter(row => row.decision === 'caveat' || row.decision === 'unresolved' && row.severity !== 'critical')
            .map(row => row.interpretation ?? 'The available official sources disagree; this detail remains uncertain.')])];
        return { id: claim.id, text: claim.text, critical: claim.critical, status: caveats.length ? 'qualified' : claim.citations.length ? 'supported' : 'unresolved',
            evidenceIds: claim.citations, conflictIds: related.map(row => row.id), caveats };
    }) : [];
    const cited = [...new Set(claims.flatMap(claim => claim.evidenceIds))];
    const payload = { sessionId, planId: plan.id, disposition: draft.disposition, ...(draft.disposition === 'answer' ? {} : { reason: draft.reason }),
        claims, citations: cited.map(id => ({ evidenceId: id, ...admitted.find(row => row.id === id)!.citation })), caveats: [],
        validation: { valid: validationIssues.length === 0, issues: validationIssues, repairs, removedClaimIds },
        identities: { profileRevision: model.profile.revision, promptRevision: await groundingRevisionOf(groundingArtifacts.prompts.filter(row => ['grounding-reconcile', 'grounding-generate', 'grounding-repair'].includes(row.id)).map(row => row.revision)),
            modelIdentity: model.modelIdentity, rankerIds: [...new Set(admitted.map(row => row.rankerId))], configIdentityId: (model.modelIdentity as { identityId?: string } | null)?.identityId ?? null },
        spend: model.spent(), stopReason };
    const answer = groundingMust(validateGroundingShape('groundedAnswer', { ...payload, id: await groundingIdOf('answer', payload) }));
    const stored = await store.putAnswer(answer, expectedRevision);
    if (!stored.ok) return { ok: false as const, issue: stored.issue, answer, conflicts };
    return { ok: true as const, answer, conflicts, unused: admitted.filter(row => !cited.includes(row.id)).map(row => row.id) };
}
