import type { EvidenceCandidate, EvidenceConflict, ReconcileReply } from './contracts.gen.ts';
import type { AnswerModel } from './answer-model.ts';
import type { GroundingStore } from './store.ts';
import { groundingIdOf, immutableGroundingJson } from './identity.ts';
import { groundingMust, groundingReject } from './errors.ts';
import { validateGroundingShape } from './schema.ts';
/** A failed interpretation retains unresolved decisions; criticality remains a host rule. */
export async function interpretEvidenceConflicts(options: { model: AnswerModel; query: string; admitted: readonly EvidenceCandidate[];
    conflicts: readonly EvidenceConflict[]; store?: Pick<GroundingStore, 'putConflict'> }) {
    const conflicts = immutableGroundingJson(options.conflicts), unresolved = conflicts.filter(row => row.decision === 'unresolved');
    let interpretations: ReconcileReply['decisions'] = [], attempts = 0, failure: string | null = null;
    if (unresolved.length) {
        try {
            const reply = await options.model.run('reconcile', options.query, options.admitted, { conflicts: unresolved }, { maxRepairs: 1,
                gate(value: ReconcileReply) {
                    const valid = value.decisions.length === unresolved.length && new Set(value.decisions.map(row => row.conflictId)).size === unresolved.length
                        && value.decisions.every(row => unresolved.some(conflict => conflict.id === row.conflictId && (conflict.severity !== 'critical' || row.decision === 'refuse')));
                    return { valid, errors: valid ? [] : [{ code: 'TGRD1005', docPath: '/decisions', message: 'Return every unresolved id once; critical conflicts require refusal.' }] };
                } });
            attempts = reply.attempts;
            if (reply.errors) failure = 'reconciliation-unavailable'; else interpretations = (reply.value as ReconcileReply).decisions;
        } catch (error) { failure = typeof (error as { reason?: unknown })?.reason === 'string' ? (error as { reason: string }).reason : 'reconciliation-unavailable'; }
    }
    const decided: EvidenceConflict[] = [];
    for (const conflict of conflicts) {
        const interpretation = interpretations.find(row => row.conflictId === conflict.id);
        if (!interpretation) { decided.push(conflict); continue; }
        const { id: _id, ...prior } = conflict;
        const payload = { ...prior, decision: interpretation.decision, interpretation: interpretation.interpretation, modelIdentity: options.model.modelIdentity };
        decided.push(groundingMust(validateGroundingShape('evidenceConflict', { ...payload, id: await groundingIdOf('conflict', payload) })));
    }
    if (options.store) {
        const stored = await options.store.putConflict(decided);
        if (!stored.ok) groundingReject(stored.issue.code, stored.issue.path, stored.issue.detail, stored.issue.cause);
    }
    return { conflicts: immutableGroundingJson(decided), attempts, failure };
}
