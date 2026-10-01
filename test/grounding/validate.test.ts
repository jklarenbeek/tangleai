import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCitationResolver, validatePrihaClaims, repairPrihaClaims, validatePrihaRepairProposal, type PrihaAnswer } from '@tangleai/grounding';
import { answerHarness, draftClaim } from '../fixtures/grounding/answer-harness.ts';
describe('native claim envelope and guarded repair', () => {
    it('maps unknown/hidden reference pointers to draft citations and refuses unsafe edits', async () => {
        const f = await answerHarness([]), resolver = await createCitationResolver([f.web]);
        const draft: PrihaAnswer = { disposition: 'answer', claims: [draftClaim(f.web.id, { citations: [f.web.id, 'fabricated'] })] };
        const checked = validatePrihaClaims(draft, resolver.view);
        assert.equal(checked.valid, false); assert.equal(checked.errors[0].code, 'EVIDENCE_REFERENCE'); assert.equal(checked.errors[0].docPath, '/claims/0/citations/1');
        const hidden = validatePrihaClaims({ disposition: 'answer', claims: [draftClaim(f.web.id)] }, { ...resolver.view, visibleEvidence: [] });
        assert.equal(hidden.valid, false); assert.equal(hidden.errors[0].code, 'EVIDENCE_HIDDEN');
        for (const proposal of [[{ op: 'replace', path: '/claims/0/critical', value: false }], [{ op: 'add', path: '/claims/0/citations/-', value: f.web.id }], [{ op: 'replace', path: '/claims/0/text', value: 'Invented.' }], [{ op: 'remove', path: '/visibleEvidence/0' }], [{ op: 'move', path: '/claims/0', from: '/claims/1' }]]) {
            assert.equal(validatePrihaRepairProposal(proposal).valid, false);
            assert.equal((await repairPrihaClaims(draft, resolver.view, proposal)).ok, false);
        }
        assert.deepEqual(draft.claims[0].citations, [f.web.id, 'fabricated']);
    });
    it('uses the native patch compiler to remove a bad citation or append a caveat', async () => {
        const f = await answerHarness([]), resolver = await createCitationResolver([f.web]);
        const draft: PrihaAnswer = { disposition: 'answer', claims: [draftClaim(f.web.id, { citations: [f.web.id, 'unknown'] })] };
        const fixed = await repairPrihaClaims(draft, resolver.view, [{ op: 'remove', path: '/claims/0/citations/1' }, { op: 'add', path: '/claims/0/caveats/-', value: 'Check the service notice.' }]);
        assert.ok(fixed.ok); assert.equal(fixed.value.disposition, 'answer'); assert.deepEqual(fixed.value.claims[0].citations, [f.web.id]);
        assert.deepEqual(fixed.value.claims[0].caveats, ['Check the service notice.']); assert.equal(validatePrihaClaims(fixed.value, resolver.view).valid, true);
        const invalid = await repairPrihaClaims(draft, resolver.view, [{ op: 'remove', path: '/claims/100' }]); assert.equal(invalid.ok, false);
    });
    it('refuses an unsupported critical envelope and never commits partial repair', async () => {
        const f = await answerHarness([]), resolver = await createCitationResolver([f.web]);
        const draft: PrihaAnswer = { disposition: 'answer', claims: [draftClaim(f.web.id, { citations: [] })] };
        assert.equal(validatePrihaClaims(draft, resolver.view).errors[0].code, 'EVIDENCE_CRITICAL');
        assert.equal((await repairPrihaClaims(draft, resolver.view, [{ op: 'add', path: '/claims/0/caveats/-', value: 'Still unsupported.' }])).ok, false);
        const removed = await repairPrihaClaims(draft, resolver.view, [{ op: 'remove', path: '/claims/0' }]); assert.ok(removed.ok); assert.equal(removed.value.disposition, 'refuse');
        assert.equal(draft.claims.length, 1); assert.deepEqual(draft.claims[0].caveats, []);
    });
    it('resolves exact web descriptors and rejects unknown ids or a changed final URL', async () => {
        const f = await answerHarness([]), resolver = await createCitationResolver([f.web]);
        const found = resolver.resolve(f.web.id); assert.ok(found.valid); assert.equal(found.value.lane, 'web');
        assert.equal(resolver.resolve('https://invented.example').valid, false);
        await assert.rejects(createCitationResolver([{ ...f.web, citation: { ...f.web.citation, url: 'https://invented.example' } }]), /fetched final URL/);
        await assert.rejects(createCitationResolver([f.local]), /retained corpus/);
    });
});
