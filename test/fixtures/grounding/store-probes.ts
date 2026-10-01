import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveProfile } from '@tangleai/config';
import type { GroundingStore, CorpusManifest } from '@tangleai/grounding';
import { contractMust, preparePrihaContractLifecycle, runPrihaStoreProbes, contractProfile } from '../../../benchmark/lib/priha-contracts.ts';
export interface GroundingProbeHost { store: GroundingStore; close(): Promise<void>; }
export function groundingStoreTests(name: string, create: (probe?: (step: string) => void) => Promise<GroundingProbeHost>) {
    describe(name, () => {
        it('the same lifecycle fixture passes on memory and SQLite', async () => {
            const host = await create();
            try { const results = await runPrihaStoreProbes(host.store); assert.equal(results.length, 11); for (const row of results) assert.equal(row.passed, true, JSON.stringify(row)); }
            finally { await host.close(); }
        });
        it('a forced rollback leaves no partial answer or manifest', async () => {
            let puts = 0, faultAt = 0;
            const host = await create(step => { if (step.startsWith('put:') && ++puts === faultAt) throw Object.assign(Error('Injected write fault.'), { code: 'FIXTURE_FAULT', docPath: '/put' }); });
            try {
                const f = await preparePrihaContractLifecycle(host.store);
                puts = 0; faultAt = 2;
                const failed = await host.store.putAnswer(f.answer, f.session.revision); assert.equal(failed.ok, false); assert.equal(failed.issue.code, 'TGRD1009'); assert.equal(failed.issue.cause!.code, 'FIXTURE_FAULT');
                faultAt = 0;
                const after = (await host.store.readTrace(f.session.id))!; assert.equal(after.answers.length, 0); assert.deepEqual(after.session, f.session);
                const retry = await host.store.putAnswer(f.answer, f.session.revision); assert.ok(retry.ok); assert.equal(retry.changes, 2);
                const repeat = await host.store.putAnswer(f.answer, f.session.revision); assert.ok(repeat.ok); assert.equal(repeat.changes, 0);
                puts = 0; faultAt = 1;
                const manifest = { ...f.manifest, id: 'faulted-manifest', sourceId: 'new-source', versionId: 'new-version' };
                assert.equal((await host.store.putManifest(manifest)).ok, false); faultAt = 0;
                assert.equal(await host.store.getManifest(manifest.sourceId, manifest.versionId), undefined);
                assert.deepEqual(await host.store.getManifest(f.manifest.sourceId, f.manifest.versionId), f.manifest);
            } finally { await host.close(); }
        });
        it('rolls back an earlier batch write when a later record crosses a profile', async () => {
            const host = await create();
            try {
                const f = await preparePrihaContractLifecycle(host.store);
                const result = await host.store.putEvidence([{ ...f.web, id: 'first-in-batch' }, { ...f.web, id: 'second-in-batch', profileRevision: 'c'.repeat(64) }]);
                assert.equal(result.ok, false); assert.equal(result.issue.code, 'TGRD1004');
                assert.deepEqual((await host.store.readTrace(f.session.id))!.evidence.map(e => e.id).sort(), [f.local.id, f.web.id].sort());
            } finally { await host.close(); }
        });
        it('admits exactly one concurrent transition for an expected revision', async () => {
            const host = await create();
            try {
                const f = await preparePrihaContractLifecycle(host.store);
                const results = await Promise.all([1, 2].map(i => host.store.transitionSession(f.session.id, { kind: 'fail', reason: 'Competing worker ' + i }, f.session.revision)));
                assert.equal(results.filter(r => r.ok).length, 1);
                const loser = results.find(r => !r.ok)!; assert.equal(loser.ok, false); assert.equal(loser.issue.code, 'TGRD1002');
                assert.equal((await host.store.getSession(f.session.id))!.revision, f.session.revision + 1);
            } finally { await host.close(); }
        });
        it('refuses foreign references, invented authority and uncurated promotion', async () => {
            const host = await create();
            try {
                const f = await preparePrihaContractLifecycle(host.store), g = await preparePrihaContractLifecycle(host.store, 'other-session');
                const checks = [
                    { value: await host.store.putEvidence([{ ...f.web, id: 'bad-query', queryId: 'foreign' }]), code: 'TGRD1004' },
                    { value: await host.store.putConflict([{ ...f.conflict, id: 'foreign-conflict', sessionId: g.session.id }]), code: 'TGRD1004' },
                    { value: await host.store.putAnswer({ ...f.answer, id: 'foreign-answer', sessionId: g.session.id }), code: 'TGRD1004' },
                    { value: await host.store.putEvidence([{ ...f.local, id: 'relabelled', authority: { ...f.local.authority, tier: 'unverified' } }]), code: 'TGRD1005' },
                    { value: await host.store.putManifest(f.web as unknown as CorpusManifest), code: 'TGRD1010' },
                    { value: await host.store.putEvidence([{ ...f.web, id: 'forged-url', citation: { ...f.web.citation, url: 'https://invented.example' } }]), code: 'TGRD1004' },
                    { value: await host.store.putEvidence([{ ...f.web, id: 'forged-authority', authority: { ...f.web.authority, tier: 'unverified' } }]), code: 'TGRD1005' },
                    { value: await host.store.putManifest({ ...f.manifest, sourceId: 'foreign-source', versionId: 'foreign-version' }), code: 'TGRD1002' },
                ];
                for (const { value, code } of checks) { assert.equal(value.ok, false, code); assert.equal(value.issue.code, code); }
            } finally { await host.close(); }
        });
        it('consumes a resolved CONFIG identity and refuses an identity with altered bytes', async () => {
            const host = await create();
            try {
                const f = await preparePrihaContractLifecycle(host.store);
                const configuration = JSON.parse(await readFile('test/fixtures/config-conformance.json', 'utf8'));
                const resolved = await resolveProfile(configuration.base); assert.ok(resolved.ok);
                const intent = { ...f.intent, id: 'resolved-identity', modelIdentity: resolved.identity };
                const valid = await host.store.putIntent(intent); assert.ok(valid.ok, JSON.stringify(valid));
                const forged = await host.store.putIntent({ ...intent, id: 'forged-identity', modelIdentity: { ...resolved.identity, identityId: 'f'.repeat(64) } });
                assert.equal(forged.ok, false); assert.equal(forged.issue.code, 'TGRD1002'); assert.equal(forged.issue.path, '/modelIdentity/identityId');
                const answer = { ...f.answer, identities: { ...f.answer.identities, modelIdentity: resolved.identity, configIdentityId: 'e'.repeat(64) } };
                const wrongRef = await host.store.putAnswer(answer); assert.equal(wrongRef.ok, false); assert.equal(wrongRef.issue.code, 'TGRD1002');
            } finally { await host.close(); }
        });
        it('bounds collected and persisted context and counts clarification turns', async () => {
            const host = await create();
            try {
                const profile = await contractProfile(); contractMust(await host.store.putProfile(profile));
                const plan = { conversationId: 'context', profileId: profile.id, profileRevision: profile.revision };
                for (const userContext of [{ district: 'collected but request-local' }, { inferredDiagnosis: 'never allowed' }] as Array<Record<string, string>>) {
                    const result = await host.store.createSession({ ...plan, userContext }); assert.equal(result.ok, false); assert.equal(result.issue.code, 'TGRD1004');
                }
                let session = contractMust(await host.store.createSession(plan));
                session = contractMust(await host.store.transitionSession(session.id, { kind: 'triage' }, session.revision));
                for (let turn = 0; turn < profile.clarification.maxTurns; turn++) {
                    session = contractMust(await host.store.transitionSession(session.id, { kind: 'askClarification' }, session.revision));
                    session = contractMust(await host.store.transitionSession(session.id, { kind: 'answerClarification', fields: { service: 'voucher desk' } }, session.revision));
                }
                session = contractMust(await host.store.transitionSession(session.id, { kind: 'askClarification' }, session.revision));
                const cap = await host.store.transitionSession(session.id, { kind: 'answerClarification', fields: { purpose: 'location' } }, session.revision);
                assert.equal(cap.ok, false); assert.equal(cap.issue.code, 'TGRD1007'); assert.deepEqual(await host.store.getSession(session.id), session);
            } finally { await host.close(); }
        });
        it('refuses unsupported critical claims and surplus visible citations atomically', async () => {
            const host = await create();
            try {
                const f = await preparePrihaContractLifecycle(host.store);
                for (const answer of [
                    { ...f.answer, claims: [{ ...f.answer.claims[0], evidenceIds: [] }], citations: [] },
                    { ...f.answer, citations: [...f.answer.citations, { evidenceId: f.web.id, ...f.web.citation }] },
                    { ...f.answer, validation: { valid: false, issues: [], repairs: 1 } },
                ]) { const result = await host.store.putAnswer(answer, f.session.revision); assert.equal(result.ok, false); assert.equal(result.issue.code, 'TGRD1008'); }
                assert.equal((await host.store.readTrace(f.session.id))!.answers.length, 0);
            } finally { await host.close(); }
        });
    });
}
