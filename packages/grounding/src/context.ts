/** Final evidence selection counts every excerpt actually serialized across both lanes. */
import { estimateTokens } from '@tangleai/core/tokens';
import type { EvidenceCandidate } from './contracts.gen.ts';
import { groundingReject } from './errors.ts';
import { immutableGroundingJson } from './identity.ts';

export function selectGroundingContext(input: readonly EvidenceCandidate[], contextTokens: number) {
    if (!Number.isSafeInteger(contextTokens) || contextTokens < 0)
        groundingReject('TGRD1007', '/contextTokens', 'Evidence selection needs a nonnegative integer ceiling.');
    const candidates: EvidenceCandidate[] = [], omittedEvidenceIds: string[] = [];
    let tokens = 0;
    for (const candidate of input) {
        const cost = estimateTokens(candidate.excerpt);
        if (tokens + cost > contextTokens) omittedEvidenceIds.push(candidate.id);
        else { candidates.push(candidate); tokens += cost; }
    }
    return immutableGroundingJson({ candidates, contextTokens: tokens, omittedEvidenceIds });
}
