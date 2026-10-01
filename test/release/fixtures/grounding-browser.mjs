import { createMemoryGroundingStore, loadGroundingProfile, evaluateProfileRules, createQueryOptimizer } from '@tangleai/grounding';
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
import schema from '@tangleai/grounding/schemas/grounding' with { type: 'json' };
export async function qualifyGroundingBrowser() {
    const profile = await loadGroundingProfile(profileDocument);
    if (!profile.valid) throw Error(JSON.stringify(profile.issues));
    const store = createMemoryGroundingStore();
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
    return { revision: profile.value.revision, writes: put.changes, replayWrites: replay.changes, status: session.value.status, emergency: evaluateProfileRules(profile.value, { text: 'RED FLAG' }).emergency, schema: schema.$id };
}
