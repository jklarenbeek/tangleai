import assert from 'node:assert/strict';
import { createMemoryGroundingStore, type GroundingStore, type GenerateGroundedClaimsOptions } from '@tangleai/grounding';
import { preparePrihaContractLifecycle } from '../../../benchmark/lib/priha-contracts.ts';
export async function answerHarness(replies: unknown[], store: GroundingStore = createMemoryGroundingStore(), originalQuery?: string) {
    const f = await preparePrihaContractLifecycle(store, 'fixture-conversation', originalQuery); let calls = 0;
    const options: GenerateGroundedClaimsOptions = { client: { endpoint: { provider: 'scripted' }, async complete(request) {
        assert.ok((request as { signal?: AbortSignal }).signal);
        const reply = replies[calls++]; assert.notEqual(reply, undefined, 'Unregistered answer call.');
        if (reply instanceof Error) throw reply;
        return { message: { content: JSON.stringify(reply) }, usage: { total_tokens: 10 } };
    } }, modelIdentity: null, profile: f.profile, sessionId: f.session.id, plan: f.plan, query: f.intent.originalQuery,
        admitted: [f.web], conflicts: [], store, clock: () => 0, expectedRevision: f.session.revision };
    return { ...f, options, store, calls: () => calls };
}
export const draftClaim = (citation: string, overrides = {}) => ({ id: 'claim', text: 'Harbour reception is in Square Hall.', critical: true, citations: [citation], caveats: [], ...overrides });
