/** Synthetic lifecycle receipts exercise the public seams, without retrieval or models. */
import { createMemoryGroundingStore, groundingIdOf, loadGroundingProfile, type GroundingProfile, type GroundingStore, type CorpusManifest, type ClarifiedIntent, type QueryPlan, type EvidenceCandidate, type WebRetrievalRun, type EvidenceConflict, type GroundedAnswer, type GroundingSession, type StoreOutcome } from '@tangleai/grounding';
import { createGroundingStore, openTangleDb } from '@tangleai/store';
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };

export function contractMust<T>(result: StoreOutcome<T>): T { if (!result.ok) throw Error(`${result.issue.code} ${result.issue.path}: ${result.issue.detail}`); return result.value; }
export async function contractProfile(): Promise<GroundingProfile> {
    const loaded = await loadGroundingProfile(profileDocument);
    if (!loaded.valid) throw Error(JSON.stringify(loaded.issues));
    return loaded.value;
}
export const PRIHA_CONTRACT_AT = '2026-06-01T00:00:00.000Z';
export const PRIHA_CONTRACT_SHA = 'a'.repeat(64);
export const EMPTY_GROUNDING_SPEND = { calls: 0, tokens: 0, ms: 0, searches: 0, fetches: 0, bytes: 0, clarificationTurns: 0, contextTokens: 0 };
export async function createPrihaContractFixture(profile: GroundingProfile, session: GroundingSession, originalQuery = 'Where is reception?') {
    const manifest: CorpusManifest = { id: 'manifest-fixture', profileId: profile.id, profileRevision: profile.revision, sourceId: 'source-fixture', versionId: 'version-fixture', status: 'active', canonicalUrl: 'https://official.harbour.example/directory', institution: 'Harbour District Service Office', authorityTier: 'official', jurisdiction: 'Harbour District', language: 'en', contentHash: PRIHA_CONTRACT_SHA, times: { effectiveAt: PRIHA_CONTRACT_AT, provenance: 'curator' }, curator: { decision: 'admit', by: 'fixture-curator', at: PRIHA_CONTRACT_AT } };
    const intent: ClarifiedIntent = { id: await groundingIdOf('intent', { sessionId: session.id, query: originalQuery }), sessionId: session.id, originalQuery, triage: 'simple', reason: 'Synthetic administrative lifecycle fixture.', answered: {}, outstanding: [], constraints: [], priorities: [], summary: 'Find reception.', turnsUsed: 0, ruleIds: ['in-scope'], promptRevision: PRIHA_CONTRACT_SHA, modelIdentity: null };
    const plan: QueryPlan = { id: await groundingIdOf('plan', { intentId: intent.id }), intentId: intent.id, queries: [{ id: 'query-fixture', text: 'Harbour reception location', why: 'Requested administrative location.', lanes: { local: true, web: true }, ruleIds: ['in-scope'] }], promptRevision: PRIHA_CONTRACT_SHA, modelIdentity: null };
    const local: EvidenceCandidate = { id: await groundingIdOf('evidence', { sessionId: session.id, lane: 'local' }), sessionId: session.id, profileRevision: profile.revision, queryId: 'query-fixture', lane: 'local', address: { sourceId: manifest.sourceId, versionId: manifest.versionId, chunkId: 'chunk-fixture' }, excerpt: 'Harbour reception is in Square Hall.', scores: { semantic: 1 }, rankerId: 'fixture', authority: { tier: manifest.authorityTier, institution: manifest.institution, ruleIds: ['curator-admission'] }, times: manifest.times, admitted: { by: ['curator-admission'], at: PRIHA_CONTRACT_AT }, citation: { url: manifest.canonicalUrl, title: 'Reception directory', headingPath: ['Location'] } };
    const web: EvidenceCandidate = { ...local, id: await groundingIdOf('evidence', { sessionId: session.id, lane: 'web' }), lane: 'web', address: { url: 'https://official.harbour.example/update', finalUrl: 'https://official.harbour.example/update', sha256: PRIHA_CONTRACT_SHA, fetchedAt: PRIHA_CONTRACT_AT, redirects: [] }, citation: { url: 'https://official.harbour.example/update', title: 'Reception notice', headingPath: [] }, authority: { tier: 'official', institution: manifest.institution, ruleIds: ['authority:official.harbour.example/'] }, times: { effectiveAt: PRIHA_CONTRACT_AT, provenance: 'content' } };
    const webRun: WebRetrievalRun = { id: await groundingIdOf('web-run', { sessionId: session.id }), sessionId: session.id, queryId: 'query-fixture', attempts: [], sufficiency: { decision: 'insufficient', reason: 'Synthetic lifecycle only; no transport executed.' }, spend: EMPTY_GROUNDING_SPEND, stopReason: 'fixture' };
    const conflict: EvidenceConflict = { id: await groundingIdOf('conflict', { sessionId: session.id }), sessionId: session.id, claimIds: ['claim-fixture'], evidenceIds: [local.id, web.id], issue: 'official-vs-official', comparison: { authority: 'same-tier', time: 'equal' }, severity: 'minor', decision: 'caveat', ruleIds: ['fixture-review'], modelIdentity: null };
    const answer: GroundedAnswer = { id: await groundingIdOf('answer', { sessionId: session.id }), sessionId: session.id, planId: plan.id, disposition: 'answer', claims: [{ id: 'claim-fixture', text: local.excerpt, critical: true, status: 'supported', evidenceIds: [local.id], conflictIds: [conflict.id], caveats: [] }], citations: [{ evidenceId: local.id, ...local.citation }], caveats: [], validation: { valid: true, issues: [], repairs: 0 }, identities: { profileRevision: profile.revision, promptRevision: PRIHA_CONTRACT_SHA, modelIdentity: null, rankerIds: ['fixture'], configIdentityId: null }, spend: EMPTY_GROUNDING_SPEND, stopReason: 'answered' };
    return { manifest, intent, plan, local, web, webRun, conflict, answer };
}
export async function preparePrihaContractLifecycle(store: GroundingStore, conversationId = 'fixture-conversation', originalQuery?: string) {
    const profile = await contractProfile(); contractMust(await store.putProfile(profile));
    let session = contractMust(await store.createSession({ conversationId, profileId: profile.id, profileRevision: profile.revision }));
    const fixture = await createPrihaContractFixture(profile, session, originalQuery);
    contractMust(await store.putManifest(fixture.manifest));
    session = contractMust(await store.transitionSession(session.id, { kind: 'triage' }, session.revision));
    contractMust(await store.putIntent(fixture.intent)); contractMust(await store.putPlan(fixture.plan));
    session = contractMust(await store.transitionSession(session.id, { kind: 'plan', intentId: fixture.intent.id, planId: fixture.plan.id }, session.revision));
    session = contractMust(await store.transitionSession(session.id, { kind: 'retrieve' }, session.revision));
    contractMust(await store.putEvidence([fixture.local, fixture.web])); contractMust(await store.putWebRun(fixture.webRun));
    session = contractMust(await store.transitionSession(session.id, { kind: 'reconcile' }, session.revision));
    contractMust(await store.putConflict([fixture.conflict]));
    session = contractMust(await store.transitionSession(session.id, { kind: 'answer' }, session.revision));
    return { profile, session, ...fixture };
}
export interface PrihaContractProbe { id: string; passed: boolean; actual: string; expected: string; }
export async function runPrihaStoreProbes(store: GroundingStore): Promise<PrihaContractProbe[]> {
    const f = await preparePrihaContractLifecycle(store), probes: PrihaContractProbe[] = [];
    const record = (id: string, actual: string, expected: string) => probes.push({ id, actual, expected, passed: actual === expected });
    const code = (result: StoreOutcome<unknown>) => result.ok ? 'ok' : result.issue.code;
    record('atomic-answer', code(await store.putAnswer(f.answer, f.session.revision)), 'ok');
    record('terminal-status', (await store.getSession(f.session.id))!.status, 'answered');
    const puts = [await store.putProfile(f.profile), await store.putManifest(f.manifest), await store.putIntent(f.intent), await store.putPlan(f.plan), await store.putEvidence([f.local, f.web]), await store.putWebRun(f.webRun), await store.putConflict([f.conflict]), await store.putAnswer(f.answer, f.session.revision)];
    record('immutable-replay', String(puts.reduce((sum, result) => sum + (result.ok ? result.changes : 1000), 0)), '0');
    record('changed-record', code(await store.putIntent({ ...f.intent, summary: 'Different immutable bytes.' })), 'TGRD1002');
    record('second-active', code(await store.putManifest({ ...f.manifest, id: 'another-manifest', versionId: 'another-version' })), 'TGRD1002');
    record('foreign-profile', code(await store.putEvidence([{ ...f.web, id: 'foreign-profile', profileRevision: 'b'.repeat(64) }])), 'TGRD1004');
    record('unproven-time', code(await store.putManifest({ ...f.manifest, times: { effectiveAt: PRIHA_CONTRACT_AT } } as CorpusManifest)), 'TGRD1005');
    record('dynamic-to-curated', code(await store.putManifest(f.web as unknown as CorpusManifest)), 'TGRD1010');
    record('stale-revision', code(await store.transitionSession(f.session.id, { kind: 'refresh', reason: 'Explicit fixture refresh.' }, f.session.revision)), 'TGRD1002');
    const trace = await store.readTrace(f.session.id);
    record('retained-unused', trace?.unused.join(',') ?? 'missing', f.web.id);
    record('one-terminal-revision', String(trace!.session.revision), String(f.session.revision + 1));
    return probes;
}
export async function measurePrihaStoreContracts() {
    const memory = await runPrihaStoreProbes(createMemoryGroundingStore());
    const db = await openTangleDb();
    try { const sqlite = await runPrihaStoreProbes(createGroundingStore(db)); return { memory, sqlite }; }
    finally { await db.close(); }
}
