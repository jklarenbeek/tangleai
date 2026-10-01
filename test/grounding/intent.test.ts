import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { GmplClarificationState } from '@tangleai/gmpl';
import { projectClarifiedIntent, expandGroundingPlan, inventedGroundingFacts, triageDecisionErrors,
    loadGroundingProfile, type TriageDecision } from '@tangleai/grounding';
import profileDocument from '../../packages/grounding/profiles/priha-hk.json' with { type: 'json' };
const loaded = await loadGroundingProfile(profileDocument); assert.ok(loaded.valid); const profile = loaded.value;
const decision: TriageDecision = { triage: 'complex', reason: 'The service and purpose are missing.', requiredFields: ['service', 'purpose'], intents: ['service-navigation'] };
const history: GmplClarificationState['history'] = [
    { turn: 1, questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }],
        response: { answers: { q1: '  I mean the voucher desk.\nPlease use that name.  ' } }, evidenceIds: ['human-turn-1-q1'], provenance: 'host-response' },
    { turn: 2, questions: [{ id: 'q1', text: profile.clarification.requiredFields[1]!.question }],
        response: { answers: { q1: 'I need its location.' } }, evidenceIds: ['human-turn-2-q1'], provenance: 'host-response' },
];
const input = { profile, sessionId: 'session-test', originalQuery: 'I need to visit a service desk.', triage: decision,
    history, outstanding: [], refinedQuery: 'Travel voucher desk location', promptRevision: 'a'.repeat(64), modelIdentity: null, ruleIds: ['clarify-service', 'clarify-purpose'] };
it('the intent is a projection of actual verbatim host responses and declared field kinds', async () => {
    const intent = await projectClarifiedIntent(input);
    assert.equal(intent.answered.service, history[0]!.response.answers.q1);
    assert.equal(intent.answered.purpose, history[1]!.response.answers.q1);
    assert.deepEqual(intent.priorities, [history[1]!.response.answers.q1]); assert.deepEqual(intent.constraints, []);
    assert.deepEqual(intent.outstanding, []); assert.equal(intent.turnsUsed, 2);
    assert.deepEqual(await projectClarifiedIntent(input), intent);
    assert.ok(!Object.hasOwn(intent.answered, 'age'));
});
it('missing fields stay outstanding and a foreign question cannot become a user fact', async () => {
    const intent = await projectClarifiedIntent({ ...input, history: history.slice(0, 1), outstanding: ['purpose'] });
    assert.deepEqual(intent.outstanding, ['purpose']); assert.deepEqual(Object.keys(intent.answered), ['service']);
    await assert.rejects(projectClarifiedIntent({ ...input, history: [{ ...history[0]!, questions: [{ id: 'q1', text: 'What is your diagnosis?' }] }] }), /declared question/);
    const unresolved = await projectClarifiedIntent({ ...input, outstanding: ['service', 'purpose'] });
    assert.deepEqual(unresolved.answered, {}); assert.deepEqual(unresolved.outstanding, ['service', 'purpose']);
});
it('closed vocabulary and triage gates refuse unknown fields, unconsented storage and invented user facts', () => {
    assert.deepEqual(inventedGroundingFacts('diabetes and metformin', ['diabetes'], ['diabetes', 'metformin']), ['metformin']);
    assert.deepEqual(inventedGroundingFacts('metforminase', [], ['metformin']), []);
    assert.deepEqual(inventedGroundingFacts('ＭＥＴＦＯＲＭＩＮ', [], ['metformin']), ['metformin']);
    assert.equal(triageDecisionErrors(profile, { ...decision, requiredFields: ['diagnosis'] })[0]!.docPath, '/requiredFields/0');
    assert.equal(triageDecisionErrors(profile, { ...decision, intents: ['invented-domain'] })[0]!.docPath, '/intents/0');
    const restricted = { ...profile, userContext: { ...profile.userContext, persistable: ['purpose'] } };
    assert.equal(triageDecisionErrors(restricted, decision)[0]!.code, 'TGRD1004');
});
it('the plan adds mandatory queries once and pins their rule and profile revision', async () => {
    const intent = await projectClarifiedIntent({ ...input, history: [], outstanding: [],
        triage: { triage: 'simple', reason: 'Information navigation.', requiredFields: [], intents: ['care-navigation'] } });
    const text = profile.expansions[0]!.addQueries[0]!;
    const plan = await expandGroundingPlan({ profile, intent, intents: ['care-navigation'], draft: {
        queries: [{ text: text.toUpperCase(), why: 'Community information.', lanes: { local: true, web: false } }],
    }, promptRevision: 'b'.repeat(64), modelIdentity: null });
    assert.equal(plan.queries.length, 1); assert.deepEqual(plan.queries[0]!.ruleIds, ['community-first']);
    assert.deepEqual(plan.queries[0]!.lanes, { local: true, web: true }); assert.equal(plan.profileRevision, profile.revision);
    const missing = await projectClarifiedIntent({ ...input, history: [], outstanding: ['service', 'purpose'] });
    await assert.rejects(expandGroundingPlan({ profile, intent: missing, intents: decision.intents, draft: { queries: [{ text: 'desk', why: 'lookup', lanes: { local: true, web: true } }] },
        promptRevision: 'b'.repeat(64), modelIdentity: null }), /remain unknown/);
});
