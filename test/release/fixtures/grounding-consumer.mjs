import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createMemoryGroundingStore, loadGroundingProfile, evaluateProfileRules } from '@tangleai/grounding';
import { createGroundingStore, openTangleDb } from '@tangleai/store';
import schema from '@tangleai/grounding/schemas/grounding' with { type: 'json' };
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
assert.match(import.meta.resolve('@tangleai/grounding'), /\.js$/);
assert.equal(schema.$id, 'https://tangleai.dev/schemas/governed-grounding');
const loaded = await loadGroundingProfile(profileDocument); assert.ok(loaded.valid);
assert.equal(evaluateProfileRules(loaded.value, { text: 'RED FLAG' }).emergency, 'emergency-route');
const root = process.env.TANGLE_FIXTURE_DIRECTORY; assert.ok(root);
const db = await openTangleDb({ path: join(root, 'grounding.db') });
try {
    const ids = [];
    for (const store of [createMemoryGroundingStore(), createGroundingStore(db)]) {
        const first = await store.putProfile(loaded.value), repeat = await store.putProfile(loaded.value);
        assert.ok(first.ok); assert.equal(first.changes, 1); assert.ok(repeat.ok); assert.equal(repeat.changes, 0);
        const start = await store.createSession({ conversationId: 'installed', profileId: loaded.value.id, profileRevision: loaded.value.revision }); assert.ok(start.ok);
        const triage = await store.transitionSession(start.value.id, { kind: 'triage' }, start.value.revision); assert.ok(triage.ok);
        const stale = await store.transitionSession(start.value.id, { kind: 'triage' }, start.value.revision); assert.equal(stale.ok, false); assert.equal(stale.issue.code, 'TGRD1002');
        ids.push(triage.value.id);
    }
    assert.equal(ids[0], ids[1]);
    console.log(JSON.stringify({ groundingInstalled: true, profiles: 1, repeatWrites: 0, backends: 2, revision: loaded.value.revision }));
} finally { await db.close(); }
