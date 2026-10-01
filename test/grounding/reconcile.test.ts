import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileEvidence, createMemoryGroundingStore, profileRevisionOf, createAnswerModel, interpretEvidenceConflicts, validateGroundingShape } from '@tangleai/grounding';
import { preparePrihaContractLifecycle } from '../../benchmark/lib/priha-contracts.ts';
const at = '2026-07-01T00:00:00.000Z';
describe('rule-first evidence reconciliation', () => {
    const fixture = async () => {
        const f = await preparePrihaContractLifecycle(createMemoryGroundingStore());
        return { ...f, web: { ...f.web, excerpt: 'The desk has moved to North Hall.', times: { provenance: 'content' as const, effectiveAt: '2026-06-20T00:00:00.000Z' } }, context: { sessionId: f.session.id, now: at, facts: {} } };
    };
    it('prefers newer official effective evidence and records exact winning ids', async () => {
        const f = await fixture(), result = await reconcileEvidence(f.profile, [f.local, f.web], f.context);
        assert.deepEqual(result.admitted.map(row => row.id), [f.web.id]); assert.equal(result.conflicts[0].decision, 'prefer-web');
        assert.deepEqual(result.conflicts[0].selectedEvidenceIds, [f.web.id]); assert.deepEqual(result.conflicts[0].ruleIds, ['effective-official']);
        assert.deepEqual(await reconcileEvidence(f.profile, [f.local, f.web], f.context), result);
    });
    it('counts newer unofficial noise while retaining the official local source', async () => {
        const f = await fixture(), web = { ...f.web, authority: { tier: 'community' as const, ruleIds: ['fixture-community'] } };
        const result = await reconcileEvidence(f.profile, [f.local, web], f.context);
        assert.deepEqual(result.admitted.map(row => row.id), [f.local.id]); assert.equal(result.conflicts[0].decision, 'prefer-local'); assert.equal(result.census.unofficialNoise, 1);
        assert.deepEqual((await reconcileEvidence(f.profile, [web, f.local], f.context)).conflicts, result.conflicts);
    });
    it('excludes expired, future, superseded and jurisdiction-mismatched evidence', async () => {
        const f = await fixture();
        for (const [patch, fact, reason] of [
            [{ times: { provenance: 'content', expiresAt: '2026-06-30T23:59:59.000Z' } }, {}, 'expired'],
            [{ times: { provenance: 'content', effectiveAt: '2027-01-01T00:00:00.000Z' } }, {}, 'not-yet-effective'],
            [{}, { versionStatus: 'superseded' }, 'superseded'], [{}, { jurisdiction: 'Another place' }, 'jurisdiction'],
        ] as const) {
            const result = await reconcileEvidence(f.profile, [{ ...f.web, ...patch }], { ...f.context, facts: { [f.web.id]: fact } });
            assert.equal(result.admitted.length, 0); assert.equal(result.ineligible[0].reason, reason); assert.equal(result.conflicts[0].decision, 'refuse');
        }
    });
    it('obeys explicit tier exclusions and never orders by fetchedAt or Last-Modified', async () => {
        const f = await fixture(), profile = structuredClone(f.profile); profile.authority.excludedTiers = ['community']; profile.revision = await profileRevisionOf(profile);
        const candidate = { ...f.web, profileRevision: profile.revision, authority: { tier: 'community' as const, ruleIds: ['community'] } };
        assert.equal((await reconcileEvidence(profile, [candidate], f.context)).ineligible[0].reason, 'authority-excluded');
        const unknown = { ...f.web, times: { provenance: null }, transport: { extractionVersion: 'fixture', lastModified: '2026-06-30T00:00:00.000Z' } };
        const result = await reconcileEvidence(f.profile, [f.local, unknown], f.context);
        assert.equal(result.conflicts[0].decision, 'unresolved'); assert.equal(result.admitted.length, 2);
        const unproven = await reconcileEvidence(f.profile, [f.local, { ...unknown, times: { provenance: null, effectiveAt: '2026-06-30T00:00:00.000Z' } }], f.context);
        assert.equal(unproven.census.ignoredTimeFacts, 1); assert.equal(unproven.conflicts[0].decision, 'unresolved');
    });
    it('uses host atomic topics and never confuses duplicate parent expansions with disagreement', async () => {
        const f = await fixture();
        const result = await reconcileEvidence(f.profile, [f.local, f.web], { ...f.context, facts: { [f.local.id]: { topics: ['location'] }, [f.web.id]: { topics: ['hours'] } } });
        assert.equal(result.conflicts.length, 0); assert.equal(result.admitted.length, 2);
        const duplicate = await reconcileEvidence(f.profile, [f.local, { ...f.web, excerpt: f.local.excerpt }], f.context); assert.equal(duplicate.conflicts.length, 0);
    });
    it('restricts model interpretation to caveat/refusal and leaves failed critical decisions unresolved', async () => {
        const f = await fixture(), candidates = [f.local, { ...f.web, times: { provenance: null } }];
        for (const critical of [false, true]) {
            const result = await reconcileEvidence(f.profile, candidates, { ...f.context, criticalQueries: critical ? [f.web.queryId] : [] });
            let calls = 0;
            const model = await createAnswerModel({ profile: f.profile, modelIdentity: null, clock: () => 0, client: { async complete() {
                calls++; return { message: { content: JSON.stringify({ decisions: [{ conflictId: result.conflicts[0].id, interpretation: 'Official accounts differ.', decision: 'caveat' }] }) }, usage: { total_tokens: 10 } };
            } } });
            const interpreted = await interpretEvidenceConflicts({ model, query: 'Where?', admitted: result.admitted, conflicts: result.conflicts });
            assert.equal(interpreted.conflicts[0].decision, critical ? 'unresolved' : 'caveat'); assert.equal(calls, critical ? 2 : 1);
        }
        for (const extra of [{ authority: 'official' }, { effectiveAt: at }, { decision: 'prefer-web' }]) {
            const result = validateGroundingShape('reconcileReply', { decisions: [{ conflictId: 'conflict', interpretation: 'No relabelling.', decision: 'caveat', ...extra }] }); assert.equal(result.valid, false);
        }
    });
});
