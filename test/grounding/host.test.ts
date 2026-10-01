import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MasInfrastructureCrash } from '@tangleai/mas';
import { groundingHostHarness, HOST_QUERY } from '../fixtures/grounding/host-harness.ts';
it('the native flow answers with a retained local ledger and exact completed replay', async () => {
    const h = await groundingHostHarness();
    try {
        const reply = await h.host.start({ text: HOST_QUERY, conversationId: 'simple' });
        assert.equal(reply.disposition, 'answer', JSON.stringify(reply)); assert.equal(reply.answer!.text, 'The archive desk is in Square Hall.');
        assert.equal(reply.trace.calls, 3); assert.equal(reply.trace.tokens, 30); assert.equal(h.stats().calls, 3);
        const before = h.stats(); assert.deepEqual(await h.host.enqueue(reply.sessionId), reply); assert.deepEqual(h.stats(), before);
        assert.equal((await h.host.evidence(reply.sessionId)).candidates[0]!.lane, 'local'); assert.equal((await h.host.list())[0]!.sessionId, reply.sessionId);
    } finally { await h.close(); }
});
it('the web component uses native safe-read tools and retains actual requests and spend', async () => {
    const h = await groundingHostHarness({ web: true });
    try {
        const reply = await h.host.start({ text: HOST_QUERY, conversationId: 'web' });
        assert.equal(reply.disposition, 'answer', JSON.stringify(reply)); assert.equal(reply.trace.calls, 7); assert.equal(h.stats().calls, 7);
        assert.equal(reply.trace.searches, 1); assert.equal(reply.trace.fetches, 1); assert.equal(h.stats().requests, 3);
        const native = await h.segments.store.readTrace(reply.identities.runId);
        assert.deepEqual(native!.attempts.find(row => row.invocationId === 'web-1')!.toolSteps.map(row => row.name), ['web_search', 'web_fetch']);
    } finally { await h.close(); }
});
it('a GMPL child pauses and resumes in the same root run across a SQLite reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grounding-flow-')), h = await groundingHostHarness({ complex: true, path: join(dir, 'flow.sqlite') });
    try {
        const waiting = await h.host.start({ text: HOST_QUERY, conversationId: 'complex' });
        assert.equal(waiting.disposition, 'clarification', JSON.stringify(waiting)); assert.equal(waiting.question!.text, 'Which service do you mean?');
        assert.equal(h.stats().calls, 5); await h.reopen(); assert.deepEqual(await h.host.get(waiting.sessionId), waiting);
        const reply = await h.host.respond(waiting.sessionId, waiting.question!.interactionId, { answers: { q1: 'Archive' } });
        assert.equal(reply.disposition, 'answer', JSON.stringify(reply)); assert.equal(reply.identities.runId, waiting.identities.runId); assert.equal(reply.trace.calls, 9);
        const trace = (await h.grounding.readTrace(reply.sessionId))!, ids = [trace.session.intentId, trace.session.planId, trace.answers[0]!.id];
        await h.reopen(); assert.equal((await h.host.get(reply.sessionId)).disposition, 'answer');
        const reopened = (await h.grounding.readTrace(reply.sessionId))!; assert.deepEqual([reopened.session.intentId, reopened.session.planId, reopened.answers[0]!.id], ids);
        assert.equal(h.stats().calls, 9);
    } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('policy refusal has rule provenance and no model call or invented plan', async () => {
    const h = await groundingHostHarness();
    try {
        const reply = await h.host.start({ text: 'urgent fixture signal', conversationId: 'emergency' });
        assert.equal(reply.disposition, 'refusal', JSON.stringify(reply)); assert.equal(reply.trace.calls, 0); assert.deepEqual(h.stats(), { calls: 0, requests: 0 });
        assert.deepEqual(reply.ruleIds, ['emergency-route']); assert.equal((await h.grounding.readTrace(reply.sessionId))!.plans.length, 0);
    } finally { await h.close(); }
});
for (const dead of ['model', 'embedder', 'store'] as const) it('a dead ' + dead + ' wire is a named failure', async () => {
    const h = await groundingHostHarness({ dead });
    try { const reply = await h.host.start({ text: HOST_QUERY, conversationId: dead }); assert.equal(reply.disposition, 'failure', JSON.stringify(reply)); assert.ok(reply.failure!.code.startsWith('TGRD')); }
    finally { await h.close(); }
});
it('refresh creates a distinct run and plan and retains the old answer', async () => {
    const h = await groundingHostHarness();
    try {
        const first = await h.host.start({ text: HOST_QUERY, conversationId: 'refresh' });
        const old = (await h.grounding.readTrace(first.sessionId))!, next = await h.host.refresh(first.sessionId, 'Review current information');
        assert.equal(next.disposition, 'answer', JSON.stringify(next)); assert.notEqual(next.identities.runId, first.identities.runId);
        const trace = (await h.grounding.readTrace(first.sessionId))!; assert.equal(trace.session.execution!.previousRunId, first.identities.runId);
        assert.notEqual(trace.session.planId, old.session.planId); assert.equal(trace.answers.length, 2); assert.equal(h.stats().calls, 6);
    } finally { await h.close(); }
});
it('native committed-attempt recovery does not repeat model calls after a stage crash', async () => {
    let armed = true, replayed = 0;
    const h = await groundingHostHarness({ observer: { onNodeSettle(path, status) { if (armed && path === 'generate' && status === 'completed') { armed = false; throw new MasInfrastructureCrash('registered stage crash'); } }, onNodeReplay() { replayed++; } } });
    try {
        await assert.rejects(h.host.start({ text: HOST_QUERY, conversationId: 'crash' }), MasInfrastructureCrash);
        const session = (await h.grounding.listSessions())[0]!; const before = h.stats(); h.advance();
        const reply = await h.host.enqueue(session.id); assert.equal(reply.disposition, 'answer', JSON.stringify(reply)); assert.deepEqual(h.stats(), before); assert.ok(replayed > 0);
    } finally { await h.close(); }
});
it('every committed root and clarification stage survives termination and SQLite reopen without repeated work', { timeout: 180000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grounding-every-stage-'));
    const events: string[] = [];
    async function finish(h: Awaited<ReturnType<typeof groundingHostHarness>>, id?: string) {
        let reply = id ? await h.host.enqueue(id) : await h.host.start({ text: HOST_QUERY, conversationId: 'every-stage' });
        if (reply.disposition === 'clarification') reply = await h.host.respond(reply.sessionId, reply.question!.interactionId, { answers: { q1: 'Archive' } });
        assert.equal(reply.disposition, 'answer', JSON.stringify(reply));
        const trace = (await h.grounding.readTrace(reply.sessionId))!;
        return { ids: [trace.session.id, trace.session.intentId, trace.session.planId, ...trace.answers.map(row => row.id)], stats: h.stats(), calls: reply.trace.calls };
    }
    const baseline = await groundingHostHarness({ complex: true, observer: { onNodeSettle(path, status) { if (status === 'completed') events.push(path); } } });
    let expected: Awaited<ReturnType<typeof finish>>;
    try { expected = await finish(baseline); } finally { await baseline.close(); }
    try {
        for (const [index, path] of [...new Set(events)].entries()) {
            let armed = true, crashed = false, replayed = 0;
            const h = await groundingHostHarness({ complex: true, path: join(dir, 'stage-' + index + '.sqlite'), observer: {
                onNodeSettle(current, status) { if (armed && current === path && status === 'completed') { armed = false; crashed = true; throw new MasInfrastructureCrash(path); } },
                onNodeReplay() { replayed++; },
            } });
            try {
                await assert.rejects(finish(h), MasInfrastructureCrash, path); assert.ok(crashed, path);
                const id = (await h.grounding.listSessions())[0]!.id;
                h.advance(); await h.reopen(); let actual;
                try { actual = await finish(h, id); } catch (cause) { const session = await h.grounding.getSession(id); const native = await h.segments.store.readTrace(session!.execution!.runId); throw new Error(JSON.stringify({ path, failure: session?.failure, native: native?.run.failure }), { cause }); }
                assert.deepEqual(actual, expected!, path); assert.ok(replayed > 0, path);
            } finally { await h.close(); }
        }
        assert.ok(events.some(path => path.includes('clarification/'))); assert.ok(events.includes('reconcile-model'));
    } finally { await rm(dir, { recursive: true, force: true }); }
});

it('a completely restored triage region emits restoration without repeating its model request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'grounding-restored-region-')); let armed = true;
    const restored: string[] = [];
    const h = await groundingHostHarness({ web: true, path: join(dir, 'flow.sqlite'), observer: {
        onNodeSettle(path, status) { if (armed && path === 'triage' && status === 'completed') { armed = false; throw new MasInfrastructureCrash('registered complete-region crash'); } },
        onNodeRestored(path) { restored.push(path); }, onRegionRestored(paths) { restored.push(...paths); },
    } });
    try {
        await assert.rejects(h.host.start({ text: HOST_QUERY, conversationId: 'restored-region' }), MasInfrastructureCrash);
        const id = (await h.grounding.listSessions())[0]!.id; assert.equal(h.stats().calls, 1);
        h.advance(); await h.reopen(); const reply = await h.host.enqueue(id);
        assert.equal(reply.disposition, 'answer'); assert.equal(h.stats().calls, 7); assert.equal(h.stats().requests, 3);
        assert.ok(restored.includes('triage')); assert.ok(reply.trace.replayed > 0);
    } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('a reused conversation cannot silently return an answer to a different question or mode', async () => {
    const h = await groundingHostHarness();
    try {
        const original = await h.host.start({ text: HOST_QUERY, conversationId: 'immutable-request' }), before = h.stats();
        for (const change of [{ text: 'Where is a different desk?' }, { mode: 'raw' as const }])
            await assert.rejects(h.host.start({ text: HOST_QUERY, conversationId: 'immutable-request', ...change }),
                (cause: any) => cause.issue?.code === 'TGRD1002');
        assert.deepEqual(await h.host.get(original.sessionId), original); assert.deepEqual(h.stats(), before);
    } finally { await h.close(); }
});
