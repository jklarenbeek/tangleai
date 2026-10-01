import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGroundingStore, groundingRefuse, validateGroundingShape, type GroundingRecords } from '@tangleai/grounding';
import { contractMust, EMPTY_GROUNDING_SPEND, preparePrihaContractLifecycle } from '../../benchmark/lib/priha-contracts.ts';

describe('closed grounding contracts', async () => {
    const store = createMemoryGroundingStore(), f = await preparePrihaContractLifecycle(store);
    contractMust(await store.putAnswer(f.answer, f.session.revision));
    const refusal = groundingRefuse('TGRD1009', '/host', 'Missing binding.', { code: 'DOC123', docPath: '/fetch/0', message: 'Origin refused.' });
    assert.equal(refusal.valid, false);
    const triageDecision: GroundingRecords['triageDecision'] = { triage: 'simple', reason: 'Known administrative query.', requiredFields: [], intents: ['administrative-information'] };
    const fixtures: GroundingRecords = { webSufficiency: { sufficient: false, missing: [], refinedQueries: [], reason: 'No evidence.' }, webRerank: [], evidenceTimes: { provenance: null }, groundingProfile: f.profile, corpusManifest: f.manifest, groundingSession: f.session, clarifiedIntent: f.intent, queryPlan: f.plan, evidenceCandidate: f.local, webRetrievalRun: f.webRun, evidenceConflict: f.conflict, groundedClaim: f.answer.claims[0], groundedAnswer: f.answer, groundingIssue: refusal.issues[0], groundingSpend: EMPTY_GROUNDING_SPEND, groundingTrace: (await store.readTrace(f.session.id))!,
        triageDecision, queryDraft: { queries: [{ text: 'Harbour reception', why: 'Locate the reception.', lanes: { local: true, web: true } }] },
        clarificationQuestion: { questions: [{ id: 'q1', text: 'Which service?' }] },
        optimizerCheckpoint: { startRevision: 1, originalQuery: 'Where is reception?', route: 'simple', decision: triageDecision, stage: 'triaged', ruleIds: ['in-scope'], sourceKeys: [],
            catalogRevision: 'a'.repeat(64), vocabularyRevision: 'b'.repeat(64), models: { triage: null, plan: null },
            budget: { calls: 12, tokens: 12000, ms: 60000 }, spent: { calls: 1, tokens: 10, ms: 0 } } };
    for (const name of Object.keys(fixtures) as Array<keyof GroundingRecords>) it(`${name} validates its fixture and refuses an extra property`, () => {
        const valid = validateGroundingShape(name, fixtures[name]);
        assert.ok(valid.valid, JSON.stringify(valid));
        const invalid = validateGroundingShape(name, { ...fixtures[name], unexpected: true });
        assert.equal(invalid.valid, false);
        assert.equal(invalid.issues[0].code, 'TGRD1001');
        assert.equal(invalid.issues[0].path, name === 'webRerank' ? '' : '/unexpected');
    });
    it('refuses impossible calendar dates through the foundation format compiler', () => {
        const result = validateGroundingShape('corpusManifest', { ...f.manifest, times: { ...f.manifest.times, effectiveAt: '2026-02-31T00:00:00.000Z' } });
        assert.equal(result.valid, false); assert.equal(result.issues[0].code, 'TGRD1001'); assert.equal(result.issues[0].path, '/times/effectiveAt');
    });
    it('preserves the upstream issue code and exact pointer', () => {
        assert.deepEqual(refusal.issues[0].cause, { code: 'DOC123', docPath: '/fetch/0', message: 'Origin refused.' });
        const withPath = groundingRefuse('TGRD1009', '/host', 'Origin.', { code: 'TMAS2001', path: '/nodes/a', detail: 'No role.' });
        assert.equal(withPath.valid, false); assert.equal(withPath.issues[0].cause!.docPath, '/nodes/a');
    });
    it('refuses cross-lane addresses, nested secrets and malformed model identities', () => {
        for (const evidence of [{ ...f.local, address: f.web.address }, { ...f.web, address: f.local.address }]) assert.equal(validateGroundingShape('evidenceCandidate', evidence).valid, false);
        assert.equal(validateGroundingShape('groundedAnswer', { ...f.answer, identities: { ...f.answer.identities, apiKey: 'never-retained' } }).valid, false);
        assert.equal(validateGroundingShape('clarifiedIntent', { ...f.intent, modelIdentity: { identityId: 'a'.repeat(64), apiKey: 'never-retained' } }).valid, false);
    });
});
