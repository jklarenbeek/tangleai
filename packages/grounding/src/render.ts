import type { GroundedAnswer, GroundingProfile } from './contracts.gen.ts';
/** Visible prose is derived only from the validated ledger. No independent free-text answer exists. */
export function renderPrihaAnswer(answer: GroundedAnswer, options: { profile?: GroundingProfile; emergency?: boolean } = {}): string {
    if (answer.disposition !== 'answer') {
        const reason = answer.reason ?? 'The available evidence does not support a reliable answer.';
        const escalation = options.emergency ? options.profile?.emergency.response.text : undefined;
        return escalation ? reason + '\n' + escalation : reason;
    }
    if (!answer.validation.valid || answer.validation.issues.length || answer.claims.some(claim => claim.critical && (!claim.evidenceIds.length || !['supported', 'qualified'].includes(claim.status))))
        return 'The available evidence does not support a reliable answer.';
    return answer.claims.filter(claim => claim.status !== 'removed').map(claim => [claim.text, ...claim.caveats].join(' ')).join('; ');
}
