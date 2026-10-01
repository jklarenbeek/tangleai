import { createMemoryGroundingStore, loadGroundingProfile, evaluateProfileRules } from '@tangleai/grounding';
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
import schema from '@tangleai/grounding/schemas/grounding' with { type: 'json' };
export async function qualifyGroundingBrowser() {
    const profile = await loadGroundingProfile(profileDocument);
    if (!profile.valid) throw Error(JSON.stringify(profile.issues));
    const store = createMemoryGroundingStore();
    const put = await store.putProfile(profile.value), replay = await store.putProfile(profile.value);
    const session = await store.createSession({ conversationId: 'installed-browser', profileId: profile.value.id, profileRevision: profile.value.revision });
    if (!put.ok || !replay.ok || !session.ok) throw Error('Grounding browser fixture failed.');
    return { revision: profile.value.revision, writes: put.changes, replayWrites: replay.changes, status: session.value.status, emergency: evaluateProfileRules(profile.value, { text: 'RED FLAG' }).emergency, schema: schema.$id };
}
