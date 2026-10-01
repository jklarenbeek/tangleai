import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createGroundingStore, createGroundingClarificationHost } from '@tangleai/store';
import { createQueryOptimizer, loadGroundingProfile, profileRevisionOf, groundingArtifacts, type OptimizerOutcome, type QueryOptimizerOptions } from '@tangleai/grounding';
import profileDocument from '../../packages/grounding/profiles/priha-hk.json' with { type: 'json' };
const loaded = await loadGroundingProfile(profileDocument); assert.ok(loaded.valid); const profile = loaded.value;
const AT = '2026-06-01T00:00:00.000Z', vocabulary = ['65 years old', 'diabetes', 'metformin'];
const simple = { triage: 'simple', reason: 'Known reception query.', requiredFields: [], intents: ['administrative-information'] };
const complex = { triage: 'complex', reason: 'Unknown service and purpose.', requiredFields: ['service', 'purpose'], intents: ['service-navigation'] };
const planReply = { queries: [{ text: 'Harbour reception location', why: 'Find reception.', lanes: { local: true, web: true } }] };
const resolution = (outstanding: string[], refinedQuery = 'I need to visit a service desk.') => ({ resolved: !outstanding.length, refinedQuery,
    result: { answer: '', disposition: outstanding.length ? 'needs-information' : 'completed', claims: [], findings: [], outstandingQuestions: outstanding } });
type Step = [stage: string, reply: unknown];
const twice = (stage: string, reply: unknown): Step[] => [[stage, reply], [stage, reply]];
function yes(outcome: OptimizerOutcome) { assert.ok(outcome.ok, JSON.stringify(outcome)); return outcome.value; }
async function rig(steps: Step[], options: { path?: string; budget?: QueryOptimizerOptions['budget']; clock?: () => number; profile?: QueryOptimizerOptions['profile']; factVocabulary?: string[] } = {}) {
    const activeProfile = options.profile ?? profile;
    let calls = 0, replays = 0;
    const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
        const next = steps[calls++]; assert.ok(next, 'Unexpected scripted request');
        const messages = (request as { messages: Array<{ content: string }> }).messages;
        const artifact = groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-' + next[0]); assert.ok(artifact);
        assert.ok(messages.some(message => typeof message.content === 'string' && message.content.includes(artifact.role.instructions)), 'Wrong prompt revision for ' + next[0]);
        return { message: { role: 'assistant', content: JSON.stringify(next[1]) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } };
    const open = () => openTangleDb({ ...(options.path ? { path: options.path } : {}), jobs: { now: () => 1_000_000, random: () => 0.5 } });
    let db = await open(), store = createGroundingStore(db), host = createGroundingClarificationHost(db,
        { now: () => AT, deadlineFor: () => '2026-06-02T00:00:00.000Z', observer: { onNodeReplay() { replays++; } } });
    assert.ok((await store.putProfile(activeProfile)).ok);
    const created = await store.createSession({ conversationId: 'optimizer-test', profileId: activeProfile.id, profileRevision: activeProfile.revision }); assert.ok(created.ok);
    const session = created.value;
    const optimizer = () => createQueryOptimizer({ profile: activeProfile, clients: { triage: { client, identity: null }, plan: { client, identity: null } },
        budget: options.budget, store, clock: options.clock ?? (() => 0), clarification: host, factVocabulary: options.factVocabulary ?? vocabulary });
    return { session, optimizer, calls: () => calls, replays: () => replays, store: () => store, host: () => host,
        async close() { await db.close(); }, async reopen() { await db.close(); db = await open(); store = createGroundingStore(db);
            host = createGroundingClarificationHost(db, { now: () => AT, deadlineFor: () => '2026-06-02T00:00:00.000Z', observer: { onNodeReplay() { replays++; } } }); } };
}
for (const [text, reason, rule] of [
    ['Earlier I wrote: the fictional emergency test phrase RED FLAG appears here.', 'emergency', 'emergency-route'],
    ['Please tell me a medication dosage today.', 'out_of_scope', 'out-of-scope-dosage'],
]) it('rules run before any model: ' + reason, async () => {
    const f = await rig([]); try {
        const result = yes(await f.optimizer().triage(f.session, text));
        assert.equal(result.disposition, 'refuse'); assert.equal(result.reason, reason); assert.deepEqual(result.ruleIds, [rule]);
        assert.equal(result.session.status, 'refused'); assert.equal(f.calls(), 0);
        assert.deepEqual((await f.store().readTrace(f.session.id))!.evidence, []);
    } finally { await f.close(); }
});
it('a zero clarification allowance refuses without starting a MAS run', async () => {
    const narrowed = structuredClone(profile); narrowed.clarification.maxTurns = 0; narrowed.revision = await profileRevisionOf(narrowed);
    const f = await rig([['triage', complex]], { profile: narrowed });
    try {
        const start = yes(await f.optimizer().triage(f.session, 'Which service?'));
        const refused = yes(await f.optimizer().clarify(start.session)); assert.equal(refused.reason, 'insufficient_detail');
        assert.deepEqual(refused.intent!.outstanding, ['service', 'purpose']); assert.equal(f.calls(), 1);
        assert.equal(refused.session.optimization!.runId, undefined); assert.ok(refused.intent!.ruleIds.includes('clarification-cap'));
        assert.deepEqual(yes(await f.optimizer().clarify(f.session)).intent, refused.intent);
    } finally { await f.close(); }
});
it('a refreshed turn receives a new clarification run and cannot reuse earlier host answers', async () => {
    const unresolved = resolution(['service']), question = { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }] };
    const cycle: Step[] = [['triage', { ...complex, requiredFields: ['service'] }], ...twice('resolve', unresolved), ...twice('question', question), ...twice('resolve', unresolved), ...twice('question', question), ...twice('resolve', unresolved)];
    const f = await rig([...cycle, ...cycle]);
    try {
        const query = 'Help me with a service.';
        let result = yes(await f.optimizer().clarify(yes(await f.optimizer().triage(f.session, query)).session));
        for (let i = 0; i < 2; i++) result = yes(await f.optimizer().resume(result.session, { interactionId: result.interactionId!, expectedRevision: 0, responseKey: 'old-' + i, value: { answers: { q1: 'I cannot specify it.' } } }));
        const old = result.session.optimization!.runId;
        const refreshed = await f.store().transitionSession(result.session.id, { kind: 'refresh', reason: 'User starts again.' }, result.session.revision); assert.ok(refreshed.ok);
        const next = yes(await f.optimizer().clarify(yes(await f.optimizer().triage(refreshed.value, query)).session));
        assert.equal(next.disposition, 'clarification'); assert.notEqual(next.session.optimization!.runId, old);
        assert.equal(next.session.turn, 0); assert.equal(f.calls(), 16); assert.equal(next.spend.calls, 5);
    } finally { await f.close(); }
});
it('checkpoint pins and spend cannot be rewritten through the durable store', async () => {
    const f = await rig([['triage', simple]]);
    try {
        const ready = yes(await f.optimizer().triage(f.session, 'Where is reception?')), cp = ready.session.optimization!;
        for (const patch of [{ startRevision: cp.startRevision + 1 }, { vocabularyRevision: '0'.repeat(64) }, { budget: { ...cp.budget, calls: 1 } }, { spent: { ...cp.spent, calls: 0 } }]) {
            const outcome = await f.store().transitionSession(ready.session.id, { kind: 'recordOptimization', optimization: { ...cp, ...patch } }, ready.session.revision);
            assert.ok(!outcome.ok); assert.ok(['TGRD1002', 'TGRD1007'].includes(outcome.issue.code));
            assert.deepEqual(await f.store().getSession(ready.session.id), ready.session);
        }
    } finally { await f.close(); }
});
it('resolution cannot close a field without host input or invent registered facts', async () => {
    for (const reply of [resolution([], 'Voucher desk'), resolution(['service', 'purpose'], 'metformin desk')]) {
        const f = await rig([['triage', complex], ...twice('resolve', reply)]);
        try {
            const start = yes(await f.optimizer().triage(f.session, 'Which service?')), result = await f.optimizer().clarify(start.session);
            assert.ok(!result.ok); assert.equal(result.issue.code, 'TGRD1001'); assert.equal(f.calls(), 3);
            assert.deepEqual((await f.store().readTrace(f.session.id))!.intents, []);
        } finally { await f.close(); }
    }
});
it('triage fails closed after its one structured repair and performs no retrieval', async () => {
    const f = await rig(twice('triage', { ...simple, requiredFields: ['age'], intents: ['invented-intent'] }));
    try {
        const result = await f.optimizer().triage(f.session, 'Where is reception?'); assert.ok(!result.ok);
        assert.equal(result.issue.code, 'TGRD1001'); assert.equal(result.stopReason, 'triage-unavailable'); assert.equal(result.session!.status, 'failed');
        assert.equal(f.calls(), 2); assert.match(result.issue.cause!.message, /"attempts":2/);
        assert.deepEqual((await f.store().readTrace(f.session.id))!.plans, []);
    } finally { await f.close(); }
});
it('simple intent produces a pinned plan and completed replay costs no model calls', async () => {
    const f = await rig([['triage', simple], ['plan', planReply]]);
    try {
        const triaged = yes(await f.optimizer().triage(f.session, 'Where is Harbour reception?')); assert.equal(triaged.disposition, 'ready');
        const planned = yes(await f.optimizer().plan(triaged.session)); assert.equal(planned.disposition, 'planned');
        assert.equal(planned.plan!.profileRevision, profile.revision); assert.equal(planned.spend.calls, 2); assert.equal(planned.spend.tokens, 20);
        assert.deepEqual(yes(await f.optimizer().plan(f.session)).plan, planned.plan); assert.equal(f.calls(), 2);
    } finally { await f.close(); }
});
it('clarification pauses durably and resumes with stable ids, verbatim facts and shared twelve-call budget', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grounding-clarify-'));
    const steps: Step[] = [['triage', complex], ...twice('resolve', resolution(['service', 'purpose'])),
        ...twice('question', { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }] }),
        ...twice('resolve', resolution(['purpose'])), ...twice('question', { questions: [{ id: 'q1', text: profile.clarification.requiredFields[1]!.question }] }),
        ...twice('resolve', resolution([], 'Travel voucher desk location')), ['plan', { queries: [{ ...planReply.queries[0]!, text: 'Travel voucher desk location' }] }]];
    const f = await rig(steps, { path: join(directory, 'state.sqlite') });
    try {
        const triaged = yes(await f.optimizer().triage(f.session, 'I need to visit a service desk.')); assert.equal(triaged.disposition, 'needs-clarification');
        const wait = yes(await f.optimizer().clarify(triaged.session)); assert.equal(wait.disposition, 'clarification'); assert.equal(f.calls(), 5);
        await f.reopen(); const replay = yes(await f.optimizer().clarify(f.session));
        assert.equal(replay.interactionId, wait.interactionId); assert.equal(replay.session.id, wait.session.id); assert.equal(f.calls(), 5);
        const response = { interactionId: wait.interactionId!, expectedRevision: wait.interactionRevision!, responseKey: 'answer-1', value: { answers: { q1: '  I mean the voucher desk.  ' } } };
        const second = yes(await f.optimizer().resume(replay.session, response)); assert.equal(second.disposition, 'clarification'); assert.equal(f.calls(), 9);
        const duplicate = await f.optimizer().resume(second.session, response); assert.ok(!duplicate.ok); assert.equal(duplicate.issue.code, 'TGRD1003'); assert.equal(duplicate.issue.cause!.code, 'TMAS2007'); assert.equal(f.calls(), 9);
        await f.reopen(); const resolved = yes(await f.optimizer().resume(second.session, { interactionId: second.interactionId!, expectedRevision: second.interactionRevision!, responseKey: 'answer-2', value: { answers: { q1: 'I need its location.' } } }));
        assert.equal(resolved.disposition, 'ready'); assert.equal(resolved.intent!.answered.service, response.value.answers.q1);
        assert.equal(resolved.intent!.answered.purpose, 'I need its location.'); assert.deepEqual(resolved.intent!.outstanding, []); assert.equal(f.calls(), 11);
        const planned = yes(await f.optimizer().plan(resolved.session)); assert.equal(planned.spend.calls, 12); assert.equal(f.calls(), 12);
        const intentId = planned.intent!.id; await f.reopen(); assert.equal(yes(await f.optimizer().plan(f.session)).intent!.id, intentId); assert.equal(f.calls(), 12);
        assert.ok(f.replays() > 0, 'native MAS node replay was observed');
    } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});
it('the exhausted turn cap is an explicit non-answer with no invented field', async () => {
    const unresolved = resolution(['service']), question = { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }] };
    const f = await rig([['triage', { ...complex, requiredFields: ['service'] }], ...twice('resolve', unresolved), ...twice('question', question), ...twice('resolve', unresolved), ...twice('question', question), ...twice('resolve', unresolved)]);
    try {
        const start = yes(await f.optimizer().triage(f.session, 'Help me with a service.')); let result = yes(await f.optimizer().clarify(start.session));
        for (let i = 0; i < 2; i++) result = yes(await f.optimizer().resume(result.session, { interactionId: result.interactionId!, expectedRevision: result.interactionRevision!, responseKey: 'cap-' + i, value: { answers: { q1: 'I cannot specify the service.' } } }));
        assert.equal(result.disposition, 'refuse'); assert.equal(result.reason, 'insufficient_detail'); assert.deepEqual(result.intent!.outstanding, ['service']);
        assert.deepEqual(result.intent!.answered, {}); assert.equal(f.calls(), 11); assert.equal(result.session.turn, 2);
    } finally { await f.close(); }
});
it('the plan refuses an unsupplied registered user fact after one repair', async () => {
    const bad = { queries: [{ ...planReply.queries[0]!, text: 'metformin reception information' }] };
    const f = await rig([['triage', simple], ...twice('plan', bad)]);
    try {
        const ready = yes(await f.optimizer().triage(f.session, 'Where is reception?')); const result = await f.optimizer().plan(ready.session);
        assert.ok(!result.ok); assert.equal(result.issue.code, 'TGRD1001'); assert.equal(f.calls(), 3);
        assert.deepEqual((await f.store().readTrace(f.session.id))!.plans, []);
    } finally { await f.close(); }
});
it('a caller cannot weaken the pinned vocabulary by mutating its original array', async () => {
    const factVocabulary = ['metformin'], bad = { queries: [{ ...planReply.queries[0]!, text: 'metformin reception' }] };
    const f = await rig([['triage', simple], ...twice('plan', bad)], { factVocabulary });
    try {
        const optimizer = f.optimizer(), ready = yes(await optimizer.triage(f.session, 'Where is reception?'));
        factVocabulary.length = 0;
        const result = await optimizer.plan(ready.session); assert.ok(!result.ok); assert.equal(result.issue.code, 'TGRD1001');
        assert.equal(f.calls(), 3); assert.deepEqual((await f.store().readTrace(f.session.id))!.plans, []);
    } finally { await f.close(); }
});
it('the shared call budget survives the triage to plan boundary', async () => {
    const f = await rig([['triage', simple]], { budget: { calls: 1 } });
    try { const ready = yes(await f.optimizer().triage(f.session, 'Where is reception?')); const result = await f.optimizer().plan(ready.session);
        assert.ok(!result.ok); assert.equal(result.issue.code, 'TGRD1007'); assert.equal(result.stopReason, 'budget-turns'); assert.equal(f.calls(), 1); assert.equal(result.session!.optimization!.spent.calls, 1);
    } finally { await f.close(); }
});
it('recovers an accepted response and native resume outbox after SQLite reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grounding-outbox-'));
    const f = await rig([['triage', { ...complex, requiredFields: ['service'] }], ...twice('resolve', resolution(['service'])),
        ...twice('question', { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }] }),
        ...twice('resolve', resolution([], 'Voucher service information'))], { path: join(directory, 'state.sqlite') });
    try {
        const start = yes(await f.optimizer().triage(f.session, 'Which service?')); const wait = yes(await f.optimizer().clarify(start.session));
        assert.ok((await f.host().store.respondInteraction(wait.interactionId!, { answers: { q1: 'The voucher service.' } }, wait.interactionRevision!, 'accepted-before-crash')).ok);
        await f.reopen(); const resolved = yes(await f.optimizer().clarify(f.session));
        assert.equal(resolved.disposition, 'ready'); assert.equal(resolved.session.turn, 1); assert.equal(resolved.intent!.answered.service, 'The voucher service.');
        assert.equal(f.calls(), 7); assert.deepEqual(yes(await f.optimizer().clarify(f.session)).intent, resolved.intent); assert.equal(f.calls(), 7);
    } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});
it('reconciles a committed MAS wait with an unfinished grounding checkpoint without repeating calls', async () => {
    const f = await rig([['triage', { ...complex, requiredFields: ['service'] }], ...twice('resolve', resolution(['service'])),
        ...twice('question', { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }] })]);
    try {
        const start = yes(await f.optimizer().triage(f.session, 'Which service?')); const wait = yes(await f.optimizer().clarify(start.session));
        // This is the durable state at the response-independent checkpoint window.
        const marked = await f.store().transitionSession(wait.session.id, { kind: 'recordOptimization', optimization: { ...wait.session.optimization!, inFlight: 'clarify' } }, wait.session.revision); assert.ok(marked.ok);
        const replay = yes(await f.optimizer().clarify(marked.value)); assert.equal(replay.interactionId, wait.interactionId); assert.equal(f.calls(), 5);
        assert.equal(replay.session.optimization!.inFlight, undefined);
    } finally { await f.close(); }
});
it('turns, tokens and active milliseconds fail with named stops while preserving incurred spend', async () => {
    for (const [budget, clock, expectedCalls, reason] of [
        [{ tokens: 5 }, () => 0, 1, 'budget-tokens'],
        [{ ms: 1 }, (() => { let tick = 0; return () => tick += 2; })(), 0, 'budget-ms'],
    ] as const) {
        const f = await rig([['triage', simple]], { budget, clock });
        try { const result = await f.optimizer().triage(f.session, 'Where is reception?'); assert.ok(!result.ok);
            assert.equal(result.issue.code, 'TGRD1007'); assert.equal(result.stopReason, reason); assert.equal(f.calls(), expectedCalls);
            assert.equal(result.session!.optimization!.spent.calls, expectedCalls);
        } finally { await f.close(); }
    }
});
it('shared calls remain bounded across durable clarification segments including normalization', async () => {
    const f = await rig([['triage', complex], ...twice('resolve', resolution(['service', 'purpose'])),
        ...twice('question', { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0]!.question }] }),
        ...twice('resolve', resolution(['purpose'])), ...twice('question', { questions: [{ id: 'q1', text: profile.clarification.requiredFields[1]!.question }] }),
        ['resolve', resolution([], 'Voucher location')]], { budget: { calls: 10 } });
    try {
        const start = yes(await f.optimizer().triage(f.session, 'Which service?')); const wait = yes(await f.optimizer().clarify(start.session));
        const second = yes(await f.optimizer().resume(wait.session, { interactionId: wait.interactionId!, expectedRevision: 0, responseKey: 'first', value: { answers: { q1: 'Voucher service.' } } }));
        const result = await f.optimizer().resume(second.session, { interactionId: second.interactionId!, expectedRevision: 0, responseKey: 'second', value: { answers: { q1: 'Its location.' } } });
        assert.ok(!result.ok); assert.equal(result.issue.code, 'TGRD1007'); assert.equal(result.stopReason, 'budget-turns'); assert.equal(f.calls(), 10);
        assert.equal(result.session!.optimization!.spent.calls, 10);
    } finally { await f.close(); }
});
