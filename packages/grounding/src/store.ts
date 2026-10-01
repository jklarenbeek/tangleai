/** Grounding owns validation and write plans; trusted adapters own atomic persistence. */
import { equalsJson } from '@jarenjs/core/object';
import { assertStoredDocumentBundle, type StoredDocumentBundle } from '@tangleai/documents/contracts';
import { identityIdOf, validateRunIdentity } from '@tangleai/config';
import type { ClarifiedIntent, CorpusManifest, EvidenceCandidate, EvidenceConflict, GroundedAnswer, GroundingProfile, GroundingSession, GroundingTrace, QueryPlan, WebRetrievalRun } from './contracts.gen.ts';
import { GroundingAbort, groundingIssue, groundingMust, groundingReject, type StoreOutcome } from './errors.ts';
import { groundingIdOf, immutableGroundingJson } from './identity.ts';
import { loadGroundingProfile, evaluateProfileRules } from './profile.ts';
import { validateGroundingShape } from './schema.ts';
import { planSessionTransition, type SessionCommand } from './session.ts';
import { triageDecisionErrors } from './intent.ts';

export interface GroundingTables {
    profiles: GroundingProfile; manifests: CorpusManifest; sessions: GroundingSession; intents: ClarifiedIntent;
    plans: QueryPlan; evidence: EvidenceCandidate; web_runs: WebRetrievalRun; conflicts: EvidenceConflict; answers: GroundedAnswer;
}
export const GROUNDING_TABLES = ['profiles', 'manifests', 'sessions', 'intents', 'plans', 'evidence', 'web_runs', 'conflicts', 'answers'] as const;
export type GroundingTable = keyof GroundingTables;
export interface GroundingStored<K extends GroundingTable = GroundingTable> {
    id: string; sessionId: string | null; profileId: string; profileRevision: string; sourceId: string | null; status: string | null; payload: GroundingTables[K];
}
export interface GroundingQuery { sessionId?: string; profileId?: string; profileRevision?: string; sourceId?: string; status?: string; }
export interface GroundingPersistenceView {
    /** Optional corpus binding on this SAME transaction, never a nested transaction. */
    activateCorpus?(bundle: StoredDocumentBundle): Promise<number>;
    get<K extends GroundingTable>(table: K, id: string): Promise<GroundingStored<K> | undefined>;
    put<K extends GroundingTable>(table: K, row: GroundingStored<K>): Promise<void>;
    query<K extends GroundingTable>(table: K, query: GroundingQuery): Promise<GroundingStored<K>[]>;
}
/** The callback must commit all writes or roll every one back, including thrown probes. */
export interface GroundingPersistence { transaction<T>(task: (tx: GroundingPersistenceView) => Promise<T>): Promise<T>; }
export interface CreateSessionPlan { conversationId: string; profileId: string; profileRevision: string; userContext?: Record<string, string>; }
export interface GroundingStore {
    putProfile(profile: GroundingProfile): Promise<StoreOutcome<{ revision: string }>>;
    getProfile(id: string, revision: string): Promise<GroundingProfile | undefined>;
    putManifest(manifest: CorpusManifest): Promise<StoreOutcome<{ id: string }>>;
    promoteToCorpus(manifest: CorpusManifest, bundle: StoredDocumentBundle): Promise<StoreOutcome<{ id: string; versionId: string }>>;
    getManifest(sourceId: string, versionId: string): Promise<CorpusManifest | undefined>;
    createSession(plan: CreateSessionPlan): Promise<StoreOutcome<GroundingSession>>;
    getSession(id: string): Promise<GroundingSession | undefined>;
    transitionSession(id: string, command: Exclude<SessionCommand, { kind: 'start' }>, expectedRevision: number): Promise<StoreOutcome<GroundingSession>>;
    putIntent(intent: ClarifiedIntent): Promise<StoreOutcome<{ id: string }>>;
    putPlan(plan: QueryPlan): Promise<StoreOutcome<{ id: string }>>;
    putEvidence(evidence: EvidenceCandidate[]): Promise<StoreOutcome<{ ids: string[] }>>;
    putWebRun(run: WebRetrievalRun): Promise<StoreOutcome<{ id: string }>>;
    putConflict(conflicts: EvidenceConflict[]): Promise<StoreOutcome<{ ids: string[] }>>;
    /** Optional CAS commits the answer and its terminal session in the same transaction. */
    putAnswer(answer: GroundedAnswer, expectedRevision?: number): Promise<StoreOutcome<{ id: string }>>;
    readTrace(sessionId: string): Promise<GroundingTrace | undefined>;
}
const schemaNames = { profiles: 'groundingProfile', manifests: 'corpusManifest', sessions: 'groundingSession', intents: 'clarifiedIntent', plans: 'queryPlan', evidence: 'evidenceCandidate', web_runs: 'webRetrievalRun', conflicts: 'evidenceConflict', answers: 'groundedAnswer' } as const;
const profileKey = (id: string, revision: string) => JSON.stringify([id, revision]);
const manifestKey = (sourceId: string, versionId: string) => JSON.stringify([sourceId, versionId]);
const pointer = (field: string) => field.replaceAll('~', '~0').replaceAll('/', '~1');
function checkContext(profile: GroundingProfile, fields: Record<string, string>, path = '/userContext') {
    for (const field of Object.keys(fields)) {
        if (!profile.userContext.collectable.includes(field)) groundingReject('TGRD1004', `${path}/${pointer(field)}`, 'The profile does not permit collecting this user field.');
        if (!profile.userContext.persistable.includes(field)) groundingReject('TGRD1004', `${path}/${pointer(field)}`, 'The user field is request-local and cannot enter durable grounding records.');
    }
}
function checkProvenance(input: unknown) {
    if (!input || typeof input !== 'object') return;
    const value = input as Record<string, unknown>, times = value.times;
    if (times && typeof times === 'object' && Object.keys(times).some(k => k !== 'provenance') && !['content', 'metadata', 'curator'].includes(String((times as Record<string, unknown>).provenance)))
        groundingReject('TGRD1005', '/times/provenance', 'Time facts require declared provenance.');
    if (value.authority && typeof value.authority === 'object') {
        const rules = (value.authority as Record<string, unknown>).ruleIds;
        if (!Array.isArray(rules) || !rules.length) groundingReject('TGRD1005', '/authority/ruleIds', 'Authority facts require rule provenance.');
    }
}
async function checkModelIdentity(value: unknown, path: string) {
    if (value === null) return;
    const shape = validateRunIdentity(value);
    if (!shape.ok) groundingReject('TGRD1002', path + (shape.issues[0]?.path ?? ''), 'Invalid configuration identity.', shape.issues[0]);
    const { identityId, ...payload } = shape.value;
    if (identityId !== await identityIdOf(payload)) groundingReject('TGRD1002', path + '/identityId', 'Configuration identity differs from its canonical payload.');
}
export function createGroundingStoreAdapter(persistence: GroundingPersistence): GroundingStore {
    if (typeof persistence?.transaction !== 'function') throw new TypeError('An atomic grounding persistence adapter is required.');
    const read = async <K extends GroundingTable>(table: K, id: string) => persistence.transaction(async tx => {
        const value = (await tx.get(table, id))?.payload;
        return value === undefined ? undefined : immutableGroundingJson(value);
    });
    async function mutate<T>(task: (tx: GroundingPersistenceView, write: <K extends GroundingTable>(table: K, value: GroundingTables[K]) => Promise<void>, replace: (next: GroundingSession) => Promise<void>, promote: (manifest: CorpusManifest, bundle: StoredDocumentBundle) => Promise<void>) => Promise<T>): Promise<StoreOutcome<T>> {
        let changes = 0;
        try {
            const value = await persistence.transaction(async raw => {
                const requireSession = async (id: string): Promise<GroundingSession> => {
                    const row = await raw.get('sessions', id);
                    if (!row) groundingReject('TGRD1004', '/sessionId', 'The session owner is missing.');
                    return row.payload;
                };
                const sessionForPlan = async (id: string): Promise<GroundingSession> => {
                    const plan = await raw.get('plans', id);
                    if (!plan?.sessionId) groundingReject('TGRD1004', '/planId', 'The plan owner is missing.');
                    return requireSession(plan.sessionId);
                };
                const rowFor = async <K extends GroundingTable>(table: K, value: GroundingTables[K]): Promise<GroundingStored<K>> => {
                    let session: GroundingSession | undefined;
                    if (table === 'profiles') {
                        const p = value as GroundingProfile;
                        groundingMust(await loadGroundingProfile(p));
                        return { id: profileKey(p.id, p.revision), sessionId: null, profileId: p.id, profileRevision: p.revision, sourceId: null, status: null, payload: value };
                    }
                    if (table === 'manifests') {
                        const m = value as CorpusManifest, p = await raw.get('profiles', profileKey(m.profileId, m.profileRevision));
                        if (!p) groundingReject('TGRD1002', '/profileRevision', 'The curator manifest requires a retained profile revision.');
                        const peers = await raw.query('manifests', {});
                        if (peers.some(peer => peer.payload.id === m.id && (peer.payload.sourceId !== m.sourceId || peer.payload.versionId !== m.versionId))) groundingReject('TGRD1002', '/id', 'A manifest identity already names another source version.');
                        const active = peers.filter(peer => peer.sourceId === m.sourceId && peer.status === 'active');
                        if (m.status === 'active' && active.some(peer => peer.payload.versionId !== m.versionId)) groundingReject('TGRD1002', '/status', 'A source already has an active curated manifest.');
                        return { id: manifestKey(m.sourceId, m.versionId), sessionId: null, profileId: m.profileId, profileRevision: m.profileRevision, sourceId: m.sourceId, status: m.status, payload: value };
                    }
                    if (table === 'sessions') session = value as GroundingSession;
                    else if (table === 'plans') {
                        const plan = value as QueryPlan, intent = await raw.get('intents', plan.intentId);
                        if (!intent?.sessionId) groundingReject('TGRD1004', '/intentId', 'A query plan requires its retained intent.');
                        session = await requireSession(intent.sessionId);
                        if (new Set(plan.queries.map(q => q.id)).size !== plan.queries.length || plan.queries.some(q => !q.lanes.local && !q.lanes.web)) groundingReject('TGRD1001', '/queries', 'Query identities must be distinct and each query must enable a lane.');
                    } else session = await requireSession((value as { sessionId: string }).sessionId);
                    const profile = (await raw.get('profiles', profileKey(session.profileId, session.profileRevision)))?.payload;
                    if (!profile) groundingReject('TGRD1002', '/profileRevision', 'The session requires its retained profile revision.');
                    if (table === 'sessions') {
                        checkContext(profile, session.userContext);
                        const optimization = session.optimization;
                        if (optimization) {
                            if (optimization.decision) {
                                const errors = triageDecisionErrors(profile, optimization.decision);
                                if (errors.length) groundingReject('TGRD1001', '/optimization/decision' + errors[0]!.docPath, errors[0]!.message);
                                if (optimization.route !== optimization.decision.triage) groundingReject('TGRD1001', '/optimization/route', 'The optimizer route must match its triage decision.');
                            }
                            for (const dimension of ['calls', 'tokens', 'ms'] as const)
                                if (optimization.budget[dimension] > profile.budgets[dimension]) groundingReject('TGRD1007', '/optimization/budget/' + dimension, 'Optimizer budgets cannot widen the profile.');
                            await checkModelIdentity(optimization.models.triage, '/optimization/models/triage');
                            await checkModelIdentity(optimization.models.plan, '/optimization/models/plan');
                            if (optimization.intentId && (await raw.get('intents', optimization.intentId))?.sessionId !== session.id)
                                groundingReject('TGRD1004', '/optimization/intentId', 'The optimizer intent belongs to another session.');
                            if (optimization.planId && ((await sessionForPlan(optimization.planId)).id !== session.id
                                || (await raw.get('plans', optimization.planId))?.payload.intentId !== optimization.intentId))
                                groundingReject('TGRD1004', '/optimization/planId', 'The optimizer plan belongs to another intent or session.');
                        }
                        if (session.turn > profile.clarification.maxTurns || session.turn > profile.budgets.clarificationTurns) groundingReject('TGRD1007', '/turn', 'clarification-turns');
                        if (session.planId && (await sessionForPlan(session.planId)).id !== session.id) groundingReject('TGRD1004', '/planId', 'The session plan belongs to another session.');
                        if (session.intentId && (await raw.get('intents', session.intentId))?.sessionId !== session.id) groundingReject('TGRD1004', '/intentId', 'The intent belongs to another session.');
                        for (const id of session.answerIds) if ((await raw.get('answers', id))?.sessionId !== session.id) groundingReject('TGRD1004', '/answerIds', 'The answer belongs to another session.');
                    }
                    if (table === 'intents') checkContext(profile, (value as ClarifiedIntent).answered, '/answered');
                    if (table === 'plans') {
                        const plan = value as QueryPlan;
                        if (plan.queries.length > profile.clarification.maxQueries) groundingReject('TGRD1007', '/queries', 'query-count');
                        if (plan.profileRevision !== undefined && plan.profileRevision !== profile.revision)
                            groundingReject('TGRD1002', '/profileRevision', 'The plan profile revision differs from its session.');
                    }
                    if (table === 'evidence' || table === 'web_runs') {
                        const record = value as EvidenceCandidate | WebRetrievalRun;
                        if (!session.planId) groundingReject('TGRD1004', '/queryId', 'Evidence requires an applied query plan.');
                        const plan = (await raw.get('plans', session.planId))!.payload;
                        const query = plan.queries.find(q => q.id === record.queryId);
                        if (!query) groundingReject('TGRD1004', '/queryId', 'The query is foreign to this session plan.');
                        if (table === 'evidence') {
                            const e = value as EvidenceCandidate;
                            if (e.profileRevision !== session.profileRevision) groundingReject('TGRD1004', '/profileRevision', 'Evidence crosses the session profile revision.');
                            if (!query.lanes[e.lane]) groundingReject('TGRD1004', '/lane', 'This query did not authorize the evidence lane.');
                            if (e.lane === 'local' && 'sourceId' in e.address) {
                                const manifest = (await raw.get('manifests', manifestKey(e.address.sourceId, e.address.versionId)))?.payload;
                                if (manifest && (manifest.profileId !== session.profileId || manifest.profileRevision !== session.profileRevision)) groundingReject('TGRD1004', '/address', 'Local evidence crosses the curated profile revision.');
                                if (!manifest) {
                                    if (e.authority.tier !== 'unverified' || e.authority.institution !== undefined || !e.authority.ruleIds.includes('uncurated-local') || !equalsJson(e.times, { provenance: null }))
                                        groundingReject('TGRD1005', '/authority', 'Uncurated local evidence cannot assert authority or time facts.');
                                } else {
                                if (e.citation.url !== manifest.canonicalUrl) groundingReject('TGRD1004', '/citation/url', 'Local citation URL differs from the curated source.');
                                if (e.authority.tier !== manifest.authorityTier || e.authority.institution !== manifest.institution || !equalsJson(e.times, manifest.times)) groundingReject('TGRD1005', '/authority', 'Local authority and time facts must match the curated manifest.');
                                }
                            }
                            if (e.lane === 'web' && 'finalUrl' in e.address) {
                                if (e.citation.url !== e.address.finalUrl) groundingReject('TGRD1004', '/citation/url', 'Web citation URL differs from the retained final URL.');
                                const policy = evaluateProfileRules(profile, { text: '' });
                                const authority = policy.authorityOf(e.address.finalUrl);
                                if (!authority || [e.address.url, ...e.address.redirects].some(url => !policy.authorityOf(url))) groundingReject('TGRD1006', '/address', 'The retained web address or redirect is outside profile policy.');
                                if (authority.tier !== e.authority.tier || authority.institution !== e.authority.institution || !e.authority.ruleIds.includes(authority.ruleId)) groundingReject('TGRD1005', '/authority', 'Web authority must match its profile rule provenance.');
                            }
                        } else if (!query.lanes.web) groundingReject('TGRD1004', '/queryId', 'This query did not authorize web retrieval.');
                    }
                    if (table === 'conflicts') {
                        for (const id of (value as EvidenceConflict).evidenceIds) if ((await raw.get('evidence', id))?.sessionId !== session.id) groundingReject('TGRD1004', '/evidenceIds', 'A conflict references foreign or missing evidence.');
                    }
                    if (table === 'answers') {
                        const answer = value as GroundedAnswer;
                        if (answer.identities.profileRevision !== session.profileRevision) groundingReject('TGRD1004', '/identities/profileRevision', 'Answer profile differs from its session.');
                        if (answer.planId !== null && (await sessionForPlan(answer.planId)).id !== session.id) groundingReject('TGRD1004', '/planId', 'The answer plan belongs to another session.');
                        if (new Set(answer.claims.map(c => c.id)).size !== answer.claims.length) groundingReject('TGRD1001', '/claims', 'Claim identities must be distinct.');
                        const used = new Set(answer.claims.flatMap(c => c.evidenceIds));
                        const cited = new Set(answer.citations.map(c => c.evidenceId));
                        if (cited.size !== answer.citations.length || used.size !== cited.size || [...used].some(id => !cited.has(id))) groundingReject('TGRD1008', '/citations', 'Visible citations must be exactly the evidence used by claims.');
                        for (const citation of answer.citations) {
                            const e = await raw.get('evidence', citation.evidenceId);
                            if (e?.sessionId !== session.id) groundingReject('TGRD1004', '/citations', 'An answer references foreign or missing evidence.');
                            const { evidenceId: _, ...facts } = citation;
                            if (!equalsJson(facts, e.payload.citation)) groundingReject('TGRD1004', '/citations', 'Citation facts differ from retained evidence.');
                        }
                        for (const claim of answer.claims) {
                            for (const id of claim.conflictIds) if ((await raw.get('conflicts', id))?.sessionId !== session.id) groundingReject('TGRD1004', '/claims/conflictIds', 'An answer references a foreign conflict.');
                            if (answer.disposition === 'answer' && claim.critical && (!['supported', 'qualified'].includes(claim.status) || !claim.evidenceIds.length)) groundingReject('TGRD1008', '/claims', 'An unsupported critical claim cannot be answered.');
                        }
                        if (answer.disposition === 'answer' && (!answer.planId || !answer.validation.valid || answer.validation.issues.length)) groundingReject('TGRD1008', '/validation', 'An answer requires a plan and successful validation.');
                    }
                    return { id: value.id, sessionId: session.id, profileId: session.profileId, profileRevision: session.profileRevision, sourceId: null, status: table === 'sessions' ? session.status : null, payload: value };
                };
                const write = async <K extends GroundingTable>(table: K, input: GroundingTables[K]) => {
                    if (table === 'manifests' && input && typeof input === 'object' && ('lane' in input && input.lane === 'web' || !('curator' in input))) groundingReject('TGRD1010', '/curator', 'Dynamic evidence needs an explicit curator manifest before promotion.');
                    if (table === 'manifests' || table === 'evidence') checkProvenance(input);
                    const value = groundingMust(validateGroundingShape(schemaNames[table], input)) as unknown as GroundingTables[K];
                    const key = table === 'profiles' ? profileKey((value as GroundingProfile).id, (value as GroundingProfile).revision) : table === 'manifests' ? manifestKey((value as CorpusManifest).sourceId, (value as CorpusManifest).versionId) : value.id;
                    const prior = await raw.get(table, key);
                    if (prior && !equalsJson(prior.payload, value)) groundingReject('TGRD1002', '/id', 'An immutable address already contains different bytes.');
                    // Exact retained replay remains legal after later lifecycle transitions.
                    if (prior) return;
                    if ('modelIdentity' in value) await checkModelIdentity(value.modelIdentity, '/modelIdentity');
                    if (table === 'answers') {
                        const identities = (value as GroundedAnswer).identities;
                        await checkModelIdentity(identities.modelIdentity, '/identities/modelIdentity');
                        if (identities.modelIdentity !== null && identities.configIdentityId !== (identities.modelIdentity as { identityId: string }).identityId) groundingReject('TGRD1002', '/identities/configIdentityId', 'The answer must reference its effective configuration identity.');
                    }
                    await raw.put(table, await rowFor(table, value)); changes++;
                };
                const replace = async (next: GroundingSession) => {
                    const value = groundingMust(validateGroundingShape('groundingSession', next));
                    const previous = (await raw.get('sessions', value.id))?.payload.optimization, current = value.optimization;
                    if (previous && current) {
                        for (const field of ['startRevision', 'originalQuery', 'catalogRevision', 'vocabularyRevision', 'models', 'budget'] as const)
                            if (!equalsJson(previous[field], current[field])) groundingReject('TGRD1002', '/optimization/' + field, 'Optimizer identities and limits are immutable within a session turn.');
                        if (previous.decision && !equalsJson(previous.decision, current.decision)
                            || previous.runId && previous.runId !== current.runId || previous.intentId && previous.intentId !== current.intentId
                            || previous.planId && previous.planId !== current.planId)
                            groundingReject('TGRD1002', '/optimization', 'A retained triage decision or clarification run cannot change.');
                        if (Object.keys(previous.spent).some(key => current.spent[key as keyof typeof current.spent] < previous.spent[key as keyof typeof previous.spent]))
                            groundingReject('TGRD1007', '/optimization/spent', 'Optimizer spend cannot decrease.');
                    }
                    await raw.put('sessions', await rowFor('sessions', value)); changes++;
                };
                const promote = async (input: CorpusManifest, bundle: StoredDocumentBundle) => {
                    if (!input || typeof input !== 'object' || !input.curator || 'lane' in input)
                        groundingReject('TGRD1010', '/curator', 'Corpus promotion requires an explicit curator manifest.');
                    checkProvenance(input);
                    const manifest = groundingMust(validateGroundingShape('corpusManifest', input));
                    if (manifest.status !== 'active') groundingReject('TGRD1010', '/status', 'Promotion must activate an explicitly curated version.');
                    if (!raw.activateCorpus) groundingReject('TGRD1009', '/store', 'The host must bind corpus and grounding to one atomic transaction.');
                    try { assertStoredDocumentBundle(bundle); }
                    catch (cause) { groundingReject('TGRD1002', '/bundle', 'The curated document bundle is invalid.', cause); }
                    if (manifest.sourceId !== bundle.source.id || manifest.versionId !== bundle.version.id
                        || manifest.contentHash !== bundle.version.contentHash || manifest.canonicalUrl !== bundle.source.canonicalUrl)
                        groundingReject('TGRD1002', '/bundle', 'The curator manifest must name the exact activated source, version, content and canonical URL.');
                    if (!await raw.get('profiles', profileKey(manifest.profileId, manifest.profileRevision)))
                        groundingReject('TGRD1002', '/profileRevision', 'The curator profile revision must be retained.');
                    const key = manifestKey(manifest.sourceId, manifest.versionId), prior = await raw.get('manifests', key);
                    if (prior && !equalsJson(prior.payload, manifest)) groundingReject('TGRD1002', '/id', 'An existing curated version cannot change or be implicitly reactivated.');
                    for (const peer of await raw.query('manifests', { sourceId: manifest.sourceId, status: 'active' })) {
                        if (peer.id === key) continue;
                        const superseded = groundingMust(validateGroundingShape('corpusManifest', { ...peer.payload, status: 'superseded' }));
                        await raw.put('manifests', await rowFor('manifests', superseded)); changes++;
                    }
                    await write('manifests', manifest);
                    changes += await raw.activateCorpus(bundle);
                };
                return immutableGroundingJson(await task(raw, write, replace, promote));
            });
            return { ok: true, value, changes };
        } catch (error) { return { ok: false, issue: error instanceof GroundingAbort ? error.issue : groundingIssue('TGRD1009', '', 'Grounding persistence failed; the transaction was rolled back.', error) }; }
    }
    const one = <K extends 'intents' | 'plans' | 'web_runs'>(table: K, value: GroundingTables[K]) => mutate(async (_tx, write) => { await write(table, value); return { id: value.id }; });
    const store: GroundingStore = {
        putProfile: profile => mutate(async (_tx, write) => { await write('profiles', profile); return { revision: profile.revision }; }),
        getProfile: (id, revision) => read('profiles', profileKey(id, revision)),
        putManifest: manifest => mutate(async (_tx, write) => { await write('manifests', manifest); return { id: manifest.id }; }),
        promoteToCorpus: (manifest, bundle) => mutate(async (_tx, _write, _replace, promote) => { await promote(manifest, bundle); return { id: manifest.id, versionId: bundle.version.id }; }),
        getManifest: (sourceId, versionId) => read('manifests', manifestKey(sourceId, versionId)),
        createSession: plan => mutate(async (_tx, write) => {
            if (!plan || typeof plan !== 'object' || Object.keys(plan).some(k => !['conversationId', 'profileId', 'profileRevision', 'userContext'].includes(k))) groundingReject('TGRD1001', '', 'Invalid session creation plan.');
            const payload = { conversationId: plan.conversationId, profileId: plan.profileId, profileRevision: plan.profileRevision, userContext: plan.userContext ?? {} };
            const shaped = groundingMust(validateGroundingShape('groundingSession', { id: 'unaddressed', ...payload, status: 'open', turn: 0, answerIds: [], revision: 1 }));
            const session: GroundingSession = { ...shaped, id: await groundingIdOf('session', payload) };
            const transition = planSessionTransition(undefined, { kind: 'start', session });
            if (!transition.ok) throw new GroundingAbort(transition.issue);
            const retained = (await _tx.get('sessions', session.id))?.payload;
            if (retained) return retained;
            await write('sessions', transition.next); return transition.next;
        }),
        getSession: id => read('sessions', id),
        transitionSession: (id, command, expectedRevision) => mutate(async (tx, _write, replace) => {
            const current = (await tx.get('sessions', id))?.payload;
            if (!current || current.revision !== expectedRevision) groundingReject('TGRD1002', '/revision', 'The session revision changed or is missing.');
            if (!command || typeof command !== 'object') groundingReject('TGRD1001', '/command', 'Invalid session command.');
            if (command.kind === 'answer' && command.answerId !== undefined || command.kind === 'refuse' && command.answerId !== undefined) {
                const answer = (await tx.get('answers', command.answerId!))?.payload;
                if (!answer || answer.sessionId !== id || (command.kind === 'refuse') !== (answer.disposition === 'refuse')) groundingReject('TGRD1004', '/answerId', 'The terminal answer does not match this command.');
            }
            const transition = planSessionTransition(current, command);
            if (!transition.ok) throw new GroundingAbort(transition.issue);
            await replace(transition.next); return transition.next;
        }),
        putIntent: value => one('intents', value), putPlan: value => one('plans', value), putWebRun: value => one('web_runs', value),
        putEvidence: values => mutate(async (_tx, write) => { if (!Array.isArray(values)) groundingReject('TGRD1001', '', 'Evidence is a batch.'); for (const value of values) await write('evidence', value); return { ids: values.map(v => v.id) }; }),
        putConflict: values => mutate(async (_tx, write) => { if (!Array.isArray(values)) groundingReject('TGRD1001', '', 'Conflicts are a batch.'); for (const value of values) await write('conflicts', value); return { ids: values.map(v => v.id) }; }),
        putAnswer: (answer, expectedRevision) => mutate(async (tx, write, replace) => {
            answer = groundingMust(validateGroundingShape('groundedAnswer', answer));
            const prior = (await tx.get('answers', answer.id))?.payload;
            if (prior && equalsJson(prior, answer)) return { id: answer.id };
            if (expectedRevision !== undefined) {
                const current = (await tx.get('sessions', answer.sessionId))?.payload;
                if (!current || current.revision !== expectedRevision) groundingReject('TGRD1002', '/revision', 'The answer session revision changed or is missing.');
                const transition = planSessionTransition(current, { kind: answer.disposition === 'refuse' ? 'refuse' : 'answer', answerId: answer.id });
                if (!transition.ok) throw new GroundingAbort(transition.issue);
                await write('answers', answer); await replace(transition.next);
            } else await write('answers', answer);
            return { id: answer.id };
        }),
        readTrace: id => persistence.transaction(async tx => {
            const session = (await tx.get('sessions', id))?.payload;
            if (!session) return undefined;
            const profile = (await tx.get('profiles', profileKey(session.profileId, session.profileRevision)))!.payload;
            const records = async <K extends GroundingTable>(table: K) => (await tx.query(table, { sessionId: id })).map(row => row.payload);
            const answers = await records('answers'), evidence = await records('evidence'), used = new Set(answers.flatMap(a => a.claims.flatMap(c => c.evidenceIds)));
            const trace: GroundingTrace = { session, profile, intents: await records('intents'), plans: await records('plans'), evidence, webRuns: await records('web_runs'), conflicts: await records('conflicts'), answers, unused: evidence.filter(e => !used.has(e.id)).map(e => e.id) };
            return groundingMust(validateGroundingShape('groundingTrace', trace));
        }),
    };
    return Object.freeze(store);
}
