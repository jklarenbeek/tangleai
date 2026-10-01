import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateGroundedClaims, renderPrihaAnswer, validateGroundingShape, reconcileEvidence } from '@tangleai/grounding';
import { answerHarness, draftClaim } from '../fixtures/grounding/answer-harness.ts';
import { contractMust } from '../../benchmark/lib/priha-contracts.ts';
describe('claims-first grounded generation', () => {
    it('persists surviving claims atomically and renders only the ledger with exact used citations', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies); replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id, { caveats: ['Check the service notice.'] })] });
        const result = await generateGroundedClaims(f.options); assert.ok(result.ok, JSON.stringify(result));
        assert.equal(result.answer.disposition, 'answer'); assert.equal(result.answer.spend.calls, 1); assert.equal(f.calls(), 1);
        assert.equal(renderPrihaAnswer(result.answer), 'Harbour reception is in Square Hall. Check the service notice.');
        assert.deepEqual(result.answer.citations, [{ evidenceId: f.web.id, ...f.web.citation }]);
        const trace = (await f.store.readTrace(f.session.id))!; assert.deepEqual(trace.unused, [f.local.id]); assert.equal(trace.session.status, 'answered');
        assert.equal(validateGroundingShape('prihaAnswer', { disposition: 'answer', claims: [draftClaim(f.web.id)], confidence: 1 }).valid, false);
    });
    it('repairs a fabricated citation with one guarded patch and retains the valid claim', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies);
        replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id, { citations: [f.web.id, 'https://invented.example'] })] }, [{ op: 'remove', path: '/claims/0/citations/1' }]);
        const result = await generateGroundedClaims(f.options); assert.ok(result.ok); assert.equal(result.answer.disposition, 'answer');
        assert.equal(result.answer.validation.repairs, 1); assert.equal(f.calls(), 2); assert.deepEqual(result.answer.claims[0].evidenceIds, [f.web.id]);
    });
    it('refuses an unsupported critical claim after an unsafe downgrade proposal', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies);
        replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id, { citations: [] })] }, [{ op: 'replace', path: '/claims/0/critical', value: false }]);
        const result = await generateGroundedClaims(f.options); assert.ok(result.ok); assert.equal(result.answer.disposition, 'refuse');
        assert.equal(result.answer.validation.issues[0].code, 'TGRD1008'); assert.equal(result.answer.claims.length, 0); assert.equal(result.answer.citations.length, 0);
        assert.equal(f.calls(), 2); assert.ok(!renderPrihaAnswer(result.answer).includes('Square Hall'));
    });
    it('keeps a supported noncritical claim when repair removes its unsupported neighbour', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies);
        replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id, { id: 'supported', critical: false }), draftClaim(f.web.id, { id: 'unsupported', text: 'Unproven fact.', citations: [] })] }, [{ op: 'remove', path: '/claims/1' }]);
        const result = await generateGroundedClaims(f.options); assert.ok(result.ok); assert.equal(result.answer.disposition, 'answer');
        assert.deepEqual(result.answer.validation.removedClaimIds, ['unsupported']); assert.equal(result.answer.claims.length, 1);
    });
    it('stops before the next call when its shared budget is spent and retains failed physical calls', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies); replies.push({ disposition: 'answer', claims: [draftClaim('unknown')] });
        const result = await generateGroundedClaims({ ...f.options, budget: { calls: 1 } }); assert.ok(result.ok); assert.equal(result.answer.disposition, 'refuse');
        assert.equal(result.answer.stopReason, 'budget-turns'); assert.equal(f.calls(), 1); assert.equal(result.answer.spend.calls, 1);
        const failed = await answerHarness([Error('Provider unavailable.')]);
        const unavailable = await generateGroundedClaims(failed.options); assert.ok(unavailable.ok); assert.equal(unavailable.answer.disposition, 'refuse'); assert.equal(unavailable.answer.spend.calls, 1);
    });
    it('refuses critical official conflicts after bounded interpretation and never dispatches generation', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies), other = { ...f.web, id: f.web.id + '-other', excerpt: 'Harbour reception is in North Hall.' };
        contractMust(await f.store.putEvidence([other]));
        const result = await reconcileEvidence(f.profile, [f.web, other], { sessionId: f.session.id, now: '2026-07-01T00:00:00.000Z', facts: {}, criticalQueries: [f.web.queryId] });
        replies.push({ decisions: [{ conflictId: result.conflicts[0].id, interpretation: 'The sources disagree.', decision: 'refuse' }] });
        const generated = await generateGroundedClaims({ ...f.options, admitted: result.admitted, conflicts: result.conflicts });
        assert.ok(generated.ok); assert.equal(generated.answer.disposition, 'refuse'); assert.equal(f.calls(), 1); assert.equal(generated.answer.stopReason, 'critical-conflict');
        assert.ok((await f.store.readTrace(f.session.id))!.conflicts.some(row => row.decision === 'refuse'));
    });
    it('rejects confidence and missing evidence within a single total repair ceiling', async () => {
        const replies: unknown[] = [], f = await answerHarness(replies);
        replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id)], confidence: 0.99 }, { disposition: 'answer', claims: [draftClaim('fabricated')] });
        const result = await generateGroundedClaims(f.options); assert.ok(result.ok); assert.equal(result.answer.disposition, 'refuse'); assert.equal(f.calls(), 2); assert.equal(result.answer.validation.repairs, 1);
    });
});

it('charges final token overshoot and returns a budget refusal', async () => {
    const f = await answerHarness([]);
    const result = await generateGroundedClaims({ ...f.options, budget: { tokens: 5 }, client: { async complete() {
        return { message: { content: JSON.stringify({ disposition: 'answer', claims: [draftClaim(f.web.id)] }) }, usage: { total_tokens: 10 } };
    } } });
    assert.ok(result.ok); assert.equal(result.answer.disposition, 'refuse'); assert.equal(result.answer.stopReason, 'budget-tokens');
    assert.equal(result.answer.spend.tokens, 10); assert.equal(result.answer.validation.issues[0].code, 'TGRD1007');
});
it('snapshots caller policy, evidence and the chosen client before asynchronous dispatch', async () => {
    const replies: unknown[] = [], f = await answerHarness(replies);
    replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id)] });
    const options = { ...f.options, admitted: structuredClone(f.options.admitted), budget: { calls: 1 } };
    const pending = generateGroundedClaims(options);
    options.admitted[0].excerpt = 'Caller replacement.'; options.budget.calls = 0;
    options.client = { async complete() { throw Error('Caller replaced the client.'); } };
    const result = await pending; assert.ok(result.ok); assert.equal(result.answer.disposition, 'answer'); assert.equal(f.calls(), 1);
});
it('does not invoke a model for deterministic scope refusals and renders only explicit escalation text', async () => {
    const f = await answerHarness([], undefined, 'RED FLAG'), result = await generateGroundedClaims(f.options);
    assert.ok(result.ok); assert.equal(result.answer.disposition, 'refuse'); assert.equal(f.calls(), 0);
    const profile = structuredClone(f.profile); profile.emergency.response.text = 'Use the fictional test service escalation channel.';
    assert.ok(renderPrihaAnswer(result.answer, { profile, emergency: true }).endsWith(profile.emergency.response.text));
    assert.ok(!renderPrihaAnswer(result.answer, { profile: f.profile, emergency: true }).includes('directory'));
});

it('refuses a changed original turn or a repeated terminal dispatch before any model work', async () => {
    const replies: unknown[] = [], f = await answerHarness(replies); replies.push({ disposition: 'answer', claims: [draftClaim(f.web.id)] });
    const changed = await generateGroundedClaims({ ...f.options, query: 'A replacement question.' });
    assert.equal(changed.ok, false); assert.equal(changed.issue.code, 'TGRD1004'); assert.equal(f.calls(), 0);
    assert.equal((await f.store.readTrace(f.session.id))!.answers.length, 0);
    const first = await generateGroundedClaims(f.options); assert.ok(first.ok); assert.equal(f.calls(), 1);
    const repeated = await generateGroundedClaims(f.options); assert.equal(repeated.ok, false); assert.equal(repeated.issue.code, 'TGRD1003'); assert.equal(f.calls(), 1);
});
