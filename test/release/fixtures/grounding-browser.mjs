import { createMemoryGroundingStore, loadGroundingProfile, evaluateProfileRules, createQueryOptimizer, createWebLane, createReplayWebTransport, webBytesSha256, reconcileEvidence, generateGroundedClaims, renderPrihaAnswer, createGroundingWorkflow } from '@tangleai/grounding';
import { captureKeyOf } from '@tangleai/core/http-capture';
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
import schema from '@tangleai/grounding/schemas/grounding' with { type: 'json' };
export async function qualifyGroundingBrowser(suppliedStore) {
    const profile = await loadGroundingProfile(profileDocument);
    if (!profile.valid) throw Error(JSON.stringify(profile.issues));
    const store = suppliedStore ?? createMemoryGroundingStore();
    const put = await store.putProfile(profile.value), replay = await store.putProfile(profile.value);
    const session = await store.createSession({ conversationId: 'installed-browser', profileId: profile.value.id, profileRevision: profile.value.revision });
    if (!put.ok || !replay.ok || !session.ok) throw Error('Grounding browser fixture failed.');
    const replies = [{ triage: 'simple', reason: 'Reception lookup.', requiredFields: [], intents: ['administrative-information'] },
        { queries: [{ text: 'Harbour reception location', why: 'Find reception.', lanes: { local: true, web: true } }] }];
    let calls = 0;
    const client = { endpoint: { provider: 'scripted' }, async complete() { return {
        message: { role: 'assistant', content: JSON.stringify(replies[calls++]) }, usage: { prompt_tokens: 7, completion_tokens: 3 } }; } };
    const optimizer = createQueryOptimizer({ profile: profile.value, store, clock: () => 0, factVocabulary: ['metformin'],
        clients: { triage: { client, identity: null }, plan: { client, identity: null } } });
    const triage = await optimizer.triage(session.value, 'Where is reception?');
    if (!triage.ok || triage.value.disposition !== 'ready') throw Error('Installed browser triage failed.');
    const plan = await optimizer.plan(triage.value.session);
    if (!plan.ok || plan.value.disposition !== 'planned' || calls !== 2 || plan.value.spend.tokens !== 20) throw Error('Installed browser optimizer failed.');
    const url = 'https://official.harbour.example/installed-reception', search = new URL('https://search.harbour.example/search');
    search.searchParams.set('format', 'json'); search.searchParams.set('q', plan.value.plan.queries[0].text);
    const capture = async (url, body, kind, mime) => {
        const bytes = new TextEncoder().encode(body);
        return { key: await captureKeyOf(kind, 'GET', url), kind, method: 'GET', url, status: 200, headers: [['content-type', mime]], bytes, sha256: await webBytesSha256(bytes) };
    };
    const transport = await createReplayWebTransport([
        await capture(search.toString(), JSON.stringify({ results: [{ url, title: 'Reception', content: 'Discovery hint.' }] }), 'searxng', 'application/json'),
        await capture('https://official.harbour.example/robots.txt', 'User-agent: *\nAllow: /', 'document', 'text/plain'),
        await capture(url, '<html><body><h1>Reception</h1><p>Reception is in Square Hall.</p></body></html>', 'document', 'text/html'),
    ], { searxBase: 'https://search.harbour.example' });
    let webCalls = 0;
    const tool = (name, args) => ({ content: '', toolCalls: [{ id: name, name, arguments: JSON.stringify(args) }] });
    const webReplies = [tool('web_search', { query: plan.value.plan.queries[0].text }), tool('web_fetch', { url }), { content: 'Assess evidence.' },
        { content: JSON.stringify({ sufficient: true, missing: [], refinedQueries: [], reason: 'Reception is supported.' }) }];
    const lane = createWebLane({ profile: profile.value, store, transport, modelIdentity: null, clock: () => 0, now: () => '2026-06-01T00:00:00.000Z',
        client: { endpoint: { provider: 'scripted' }, async complete() { const message = webReplies[webCalls++]; if (!message) throw Error('Unexpected web call.'); return { message, usage: { total_tokens: 10 } }; } } });
    const retrieving = await store.transitionSession(plan.value.session.id, { kind: 'retrieve' }, plan.value.session.revision);
    if (!retrieving.ok) throw Error('Installed retrieval transition failed: ' + JSON.stringify(retrieving));
    const web = await lane.retrieve(retrieving.value, plan.value.plan.queries[0].id);
    if (!web.ok || web.run.stopReason !== 'sufficient' || web.candidates.length !== 1 || webCalls !== 4 || web.candidates[0].scores.rank !== 1) throw Error('Installed web execution failed: ' + JSON.stringify(web));
    const requests = transport.stats().requests, webReplay = await lane.retrieve(retrieving.value, plan.value.plan.queries[0].id);
    if (!webReplay.ok || !webReplay.replayed || JSON.stringify(webReplay.run) !== JSON.stringify(web.run) || requests !== transport.stats().requests || webCalls !== 4) throw Error('Installed web replay failed.');
    const current = await store.getSession(session.value.id);
    const reconciled = await reconcileEvidence(profile.value, web.candidates, { sessionId: current.id, now: '2026-06-01T00:00:00.000Z', facts: {} });
    const toReconcile = await store.transitionSession(current.id, { kind: 'reconcile' }, current.revision);
    if (!toReconcile.ok) throw Error('Installed reconciliation transition failed.');
    const generating = await store.transitionSession(current.id, { kind: 'answer' }, toReconcile.value.revision);
    if (!generating.ok) throw Error('Installed generation transition failed.');
    let answerCalls = 0;
    const answer = await generateGroundedClaims({ profile: profile.value, sessionId: current.id, plan: plan.value.plan, query: 'Where is reception?',
        admitted: reconciled.admitted, conflicts: reconciled.conflicts, store, expectedRevision: generating.value.revision, modelIdentity: null, clock: () => 0,
        client: { endpoint: { provider: 'scripted' }, async complete() { answerCalls++; return { message: { content: JSON.stringify({ disposition: 'answer', claims: [{ id: 'location',
            text: 'Reception is in Square Hall.', critical: true, citations: [web.candidates[0].id], caveats: [] }] }) }, usage: { total_tokens: 10 } }; } } });
    if (!answer.ok || answer.answer.disposition !== 'answer' || answerCalls !== 1 || renderPrihaAnswer(answer.answer) !== 'Reception is in Square Hall.') throw Error('Installed grounded generation failed: ' + JSON.stringify(answer));
    const workflow = await createGroundingWorkflow({ profile: profile.value, caseId: 'browser-workflow', factVocabulary: [], currentOptimization: async () => { throw Error('Compilation must not read runtime intent.'); } });
    if (!workflow.mermaid.regions.some(row => row.mermaid.includes('flowchart')) || !Object.keys(workflow.mermaid.subplans).length) throw Error('Installed browser workflow projection failed.');
    return { workflowVersionId: workflow.workflow.versionId, answerCalls, answerDisposition: answer.answer.disposition, webCalls, webRequests: requests, webCandidates: web.candidates.length, revision: profile.value.revision, writes: put.changes, replayWrites: replay.changes, status: session.value.status, emergency: evaluateProfileRules(profile.value, { text: 'RED FLAG' }).emergency, schema: schema.$id };
}
