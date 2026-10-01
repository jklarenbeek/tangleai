/** Independent dual-retrieval fixture and measurement over the unchanged claim scorer. */
import { planPrihaLive } from './priha-live.ts';
import type { PrihaLiveReceipt } from './priha-live-records.ts';
import { measurePrihaFlow } from './priha-flow.ts';
import { measurePrihaAblation, prihaPairing, decidePriha } from './priha-ablation.ts';
import { measurePrihaSafety } from './priha-safety.ts';
import { measurePrihaAnswers } from './priha-answer.ts';
import { measurePrihaLocal, type PrihaLocalTiming } from './priha-local.ts';
import { measurePrihaWeb } from './priha-web.ts';
import { measurePrihaOptimizer } from './priha-optimizer.ts';
import type { PrihaLocalQuery, PrihaLocalQueries, PrihaWebExecution, PrihaAnswerExecution, PrihaFlowExecution, PrihaCompleteExecution } from './priha.types.ts';
import { createPrihaReplay } from './priha-replay.ts';
import { contractProfile, measurePrihaStoreContracts, type PrihaContractProbe } from './priha-contracts.ts';
import { evaluateProfileRules, groundingArtifacts } from '@tangleai/grounding';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createBoundedCache } from '@jarenjs/core/cache';
import { estimateTokens } from '@tangleai/core/tokens';
import { createReportValidator, describeErrors } from './validate.ts';
import { captureKeyOf, CAPTURED_HEADERS } from './http-capture.ts';
import { scoreAnswer, matchesPredicates, type EvidenceCorpus, type EvidenceChunk, type AttemptTrace } from './grounding.ts';
import type { FixtureClaim, FixtureQuestion, AnswerValue, Predicates, SourceManifest, LiveClaims } from './grounding.types.ts';
import type { PrihaFixture as FixtureSchema, PrihaQuestion, PrihaConversation, PrihaFixtureAnswer as AnswerSchema, PrihaRow as RowSchema, PrihaCase as CaseSchema, PrihaMetrics as MetricsSchema, PrihaReport as ReportSchema, PrihaBadRow, PrihaControl, EvidenceRow } from './priha.types.ts';
import schema from '../schemas/priha.schema.json' with { type: 'json' };
import groundingSchema from '../schemas/grounding.schema.json' with { type: 'json' };
import identitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import { mean } from '@jarenjs/core/stats';
import { analyticEnvelope } from './report-envelope.ts';
import { sourceManifest } from './source-manifest.ts';
import { emptyTally } from './grounding-run.ts';
import { latency } from './stats.ts';
import { table, score } from './table.ts';
export const PRIHA_FIXTURE_PATH = 'benchmark/fixtures/priha/manifest.json';
export const PRIHA_ROWS = ['oracle', 'flat-semantic', 'local-hybrid', 'web-only', 'drag-no-optimizer', 'priha-full'] as const;
export const PRIHA_CAPABILITIES = ['instrument', 'contracts', 'local', 'optimizer', 'web', 'reconcile', 'flow', 'complete'] as const;
export const PRIHA_BAD_ROWS = ['snippet-as-evidence', 'redirect-out-of-policy', 'future-dated-page', 'fabricated-url', 'unsupported-critical', 'stale-local-preferred', 'invented-user-fact', 'clarification-cap'] as const;
export const PRIHA_CAPABILITY_ROWS = [
    { capability: 'instrument', requirements: ['oracle', 'bad-controls'] },
    { capability: 'contracts', requirements: ['grounding-contracts'] },
    { capability: 'local', requirements: ['flat-semantic.retrieval', 'local-hybrid.retrieval'] },
    { capability: 'optimizer', requirements: ['clarification-plan-census'] },
    { capability: 'web', requirements: ['web-only.retrieval', 'drag-no-optimizer.retrieval', 'priha-full.retrieval'] },
    { capability: 'reconcile', requirements: ['flat-semantic.answer', 'local-hybrid.answer', 'web-only.answer', 'drag-no-optimizer.answer', 'priha-full.answer', 'conflict-decisions'] },
    { capability: 'flow', requirements: ['flat-semantic.flow', 'local-hybrid.flow', 'web-only.flow', 'drag-no-optimizer.flow', 'priha-full.flow'] },
    { capability: 'complete', requirements: ['instrument', 'contracts', 'local', 'optimizer', 'web', 'reconcile', 'flow', 'ablation', 'safety'] },
] as const;
export type PrihaFixture = Omit<FixtureSchema, 'claims'> & {
    claims: FixtureClaim[];
};
export type PrihaAnswer = Omit<AnswerSchema, 'claims'> & {
    claims: Extract<AnswerValue, {
        disposition: 'answer';
    }>['claims'];
};
export type PrihaCase = Omit<CaseSchema, 'claims' | 'citations'> & Pick<ReturnType<typeof scoreAnswer>, 'claims' | 'citations'>;
export type PrihaMetrics = Omit<MetricsSchema, 'claims'> & {
    claims: LiveClaims;
};
export type PrihaRow = Omit<RowSchema, 'metrics' | 'cases'> & {
    metrics: PrihaMetrics | null;
    cases: PrihaCase[];
};
export type PrihaReport = Omit<ReportSchema, 'rows' | 'source' | 'fixtureSource'> & {
    rows: PrihaRow[];
    source: SourceManifest;
    fixtureSource: SourceManifest;
};
export interface LoadedPrihaFixture {
    fixture: PrihaFixture;
    fixtureId: string;
    source: SourceManifest;
    bodies: Map<string, Uint8Array>;
    conversations: PrihaConversation[];
    userFacts: string[];
    webExecution: PrihaWebExecution;
    answerExecution: PrihaAnswerExecution;
    flowExecution: PrihaFlowExecution;
    completeExecution: PrihaCompleteExecution;
    localQueries: PrihaLocalQuery[];
    corpusAddresses: Array<{ version: string; url: string }>;
    replay: ReturnType<ReturnType<typeof createPrihaReplay>['stats']>;
}
export const createPrihaValidator = () => createReportValidator(schema, [groundingSchema, identitySchema]);
const validate = createPrihaValidator();
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function mustValidate(value: unknown, label: string) { const result = validate(value); if (!result.valid)
    throw Error(label + ': ' + describeErrors(result, 5).join('; ')); }
function exactlyOnce(text: string, quote: string) { const at = text.indexOf(quote); return at >= 0 && text.indexOf(quote, at + 1) < 0; }
function unique(values: readonly string[], label: string) { if (new Set(values).size !== values.length)
    throw Error('Duplicate ' + label + '.'); }
export async function loadPrihaFixture(root = process.cwd()): Promise<LoadedPrihaFixture> {
    const manifestBytes = await readFile(join(root, PRIHA_FIXTURE_PATH)), fixture = JSON.parse(manifestBytes.toString('utf8')) as PrihaFixture;
    mustValidate(fixture, 'Invalid PriHA fixture');
    const base = resolve(root, 'benchmark/fixtures/priha'), bodies = new Map<string, Uint8Array>(), files = [{ path: PRIHA_FIXTURE_PATH, sha256: digest(manifestBytes) }];
    async function load(file: string, sha256: string) {
        const path = resolve(base, file);
        if (!path.startsWith(base + sep) || file.includes('\\'))
            throw Error('Fixture path escapes its corpus.');
        const bytes = new Uint8Array(await readFile(path));
        if (digest(bytes) !== sha256)
            throw Error('Fixture bytes do not match the manifest digest: ' + file);
        if (bodies.has(file))
            throw Error('Duplicate fixture file: ' + file);
        bodies.set(file, bytes);
        files.push({ path: 'benchmark/fixtures/priha/' + file, sha256 });
        return bytes;
    }
    const factDocument = JSON.parse(new TextDecoder().decode(await load(fixture.userFacts.file, fixture.userFacts.sha256))) as { document: 'priha-user-facts'; terms: string[] };
    mustValidate(factDocument, 'Invalid user-fact vocabulary');
    const userFacts = factDocument.terms;
    const queryDocument = JSON.parse(new TextDecoder().decode(await load(fixture.localQueries.file, fixture.localQueries.sha256))) as PrihaLocalQueries;
    mustValidate(queryDocument, 'Invalid local query registration');
    const localQueries = queryDocument.cases, corpusAddresses = queryDocument.corpusAddresses;
    unique(corpusAddresses.map(a => a.version), 'local corpus address');
    const registeredVersions = fixture.sources.flatMap(s => s.versions);
    if (corpusAddresses.length !== registeredVersions.length || corpusAddresses.some(a => !registeredVersions.some(v => v.key === a.version) || new URL(a.url).hostname !== 'official.harbour.example')) throw Error('Invalid local corpus address registration.');
    unique(localQueries.map(q => q.id), 'local query case');
    for (const query of localQueries) if (!fixture.questions.some(q => q.key === query.question)) throw Error('Local query names an unknown question.');
    if (localQueries.filter(q => q.suite !== 'paraphrase').length !== fixture.questions.length
        || fixture.questions.some(q => !localQueries.some(query => query.question === q.key && query.suite !== 'paraphrase' && query.text === q.text)))
        throw Error('Registered local queries must preserve every original question.');
    const flowExecution = JSON.parse(new TextDecoder().decode(await load(fixture.flowExecution.file, fixture.flowExecution.sha256))) as PrihaFlowExecution;
    mustValidate(flowExecution, 'Invalid flow execution registration');
    for (const pin of flowExecution.prompts) if (!groundingArtifacts.prompts.some(prompt => prompt.id === pin.id && prompt.revision === pin.revision)) throw Error('Registered flow prompt drift.');
    if (!equalsJson(flowExecution.rows, PRIHA_ROWS.slice(1)) || !equalsJson(flowExecution.paths, ['simple','complex','refusal','refresh','failure','retry']) || !fixture.questions.some(row => row.key === flowExecution.pathQuestion)) throw Error('Incomplete flow registration.');
    const completeExecution = JSON.parse(new TextDecoder().decode(await load(fixture.completeExecution.file, fixture.completeExecution.sha256))) as PrihaCompleteExecution;
    mustValidate(completeExecution, 'Invalid complete execution registration');
    if (!equalsJson(completeExecution.questionIds, fixture.questions.map(row => row.key))) throw Error('Complete execution must retain every original question.');
    unique(completeExecution.ablations.map(row => row.key), 'ablation'); unique(completeExecution.safety.map(row => row.id), 'safety suite');
    for (const record of completeExecution.records) {
        await load(record.file, record.sha256);
        if (await captureKeyOf(record.kind, record.method, record.url) !== record.key) throw Error('Invalid complete-control capture key.');
    }
    const answerExecution = JSON.parse(new TextDecoder().decode(await load(fixture.answerExecution.file, fixture.answerExecution.sha256))) as PrihaAnswerExecution;
    mustValidate(answerExecution, 'Invalid answer execution registration');
    await load(answerExecution.profile.file, answerExecution.profile.sha256);
    for (const record of answerExecution.webControls.records) {
        await load(record.file, record.sha256);
        if (await captureKeyOf(record.kind, record.method, record.url) !== record.key) throw Error('Invalid answer-control capture key.');
    }
    for (const pin of answerExecution.prompts) if (!groundingArtifacts.prompts.some(prompt => prompt.id === pin.id && prompt.revision === pin.revision)) throw Error('Registered answer prompt drift.');
    unique(answerExecution.cases.map(row => row.row + ':' + row.question), 'answer script');
    if (answerExecution.cases.length !== 5 * fixture.questions.length || answerExecution.rows.length !== 5
        || fixture.questions.some(q => answerExecution.rows.some(row => !answerExecution.cases.some(script => script.row === row.key && script.question === q.key && script.planQuery === q.text))))
        throw Error('Incomplete original-question answer scripts.');
    const versionText = new Map<string, string>(), versions = fixture.sources.flatMap(s => s.versions);
    unique(versions.map(v => v.key), 'versions');
    for (const v of versions)
        versionText.set(v.key, new TextDecoder().decode(await load(v.file, v.sha256)));
    for (const row of fixture.web) {
        if (await captureKeyOf(row.kind, row.method, row.url) !== row.key)
            throw Error('Web capture key drift: ' + row.name);
        if (row.headers.some(h => h.length !== 2 || !CAPTURED_HEADERS.includes(h[0] as typeof CAPTURED_HEADERS[number])))
            throw Error('Unregistered captured header.');
        if ((row.headers.find(h => h[0] === 'location')?.[1] ?? null) !== row.redirectTo)
            throw Error('Web redirect header mismatch.');
        const bytes = await load(row.file, row.sha256);
        versionText.set('web-' + row.name, new TextDecoder().decode(bytes));
        if (row.kind === 'searxng')
            JSON.parse(new TextDecoder().decode(bytes));
    }
    const webExecution = JSON.parse(new TextDecoder().decode(await load(fixture.webExecution.file, fixture.webExecution.sha256))) as PrihaWebExecution;
    mustValidate(webExecution, 'Invalid web execution registration');
    unique(webExecution.cases.map(row => row.id), 'web execution case');
    unique([...fixture.web, ...webExecution.records].map(row => row.key), 'web capture');
    for (const record of webExecution.records) {
        if (await captureKeyOf(record.kind, record.method, record.url) !== record.key) throw Error('Supplemental capture key drift.');
        await load(record.file, record.sha256);
    }
    for (const row of webExecution.cases) {
        if (row.question !== null && !fixture.questions.some(question => question.key === row.question)) throw Error('Web case names a foreign question.');
        if (row.required.some(id => !fixture.elements.some(element => element.key === id && element.lane === 'web'))) throw Error('Web support names a foreign element.');
        for (const step of row.script) if (groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-' + step.stage)?.revision !== step.promptRevision) throw Error('Web script prompt revision mismatch.');
    }
    const conversations: PrihaConversation[] = [];
    for (const row of fixture.conversations) {
        const value = JSON.parse(new TextDecoder().decode(await load(row.file, row.sha256))) as PrihaConversation;
        mustValidate(value, 'Invalid conversation');
        if (value.key !== row.key)
            throw Error('Conversation identity mismatch.');
        for (const step of value.optimizerScript) {
            const artifact = groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-' + step.stage);
            if (artifact?.revision !== step.promptRevision) throw Error('Optimizer script prompt revision mismatch.');
        }
        conversations.push(value);
    }
    const elements = new Map(fixture.elements.map(e => [e.key, e]));
    for (const e of fixture.elements) {
        const text = versionText.get(e.version);
        if (text === undefined || !exactlyOnce(text, e.quote))
            throw Error('Element ' + e.key + ' quote must occur exactly once in its version.');
    }
    const chunks = new Map(fixture.chunks.map(c => [c.key, c])), parents = new Map(fixture.parents.map(p => [p.key, p]));
    for (const c of fixture.chunks) {
        const g = fixture.granularities.find(g => g.id === c.granularity);
        if (!g || c.tokenCount !== estimateTokens(c.text) || c.tokenCount > g.maxTokens)
            throw Error('Chunk granularity or token count mismatch.');
        if (!versions.some(v => v.key === c.version) || c.elements.some(e => elements.get(e)?.version !== c.version || !c.text.includes(elements.get(e)!.quote)))
            throw Error('Chunk evidence membership mismatch.');
        if (c.parent === null ? g.parentTokens !== null : !parents.get(c.parent)?.children.includes(c.key) || parents.get(c.parent)?.version !== c.version || parents.get(c.parent)?.granularity !== c.granularity)
            throw Error('Chunk parent membership mismatch.');
    }
    for (const p of fixture.parents) {
        const g = fixture.granularities.find(g => g.id === p.granularity);
        if (!g?.parentTokens || p.tokenCount !== estimateTokens(p.text) || p.tokenCount > g.parentTokens || p.children.some(id => chunks.get(id)?.parent !== p.key) || p.elements.some(e => elements.get(e)?.version !== p.version || !p.text.includes(elements.get(e)!.quote)))
            throw Error('Parent granularity or evidence membership mismatch.');
    }
    for (const c of fixture.claims) {
        if (!fixture.questions.some(q => q.key === c.question && q.claims.includes(c.key)) || c.support.some(id => !elements.has(id)))
            throw Error('Claim support or question mismatch.');
        const lanes = fixture.supportByLane.find(x => x.claim === c.key);
        if (!lanes || !equalsJson([...lanes.local, ...lanes.web].sort(), [...c.support].sort()) || lanes.local.some(id => elements.get(id)!.lane !== 'local') || lanes.web.some(id => elements.get(id)!.lane !== 'web'))
            throw Error('Claim lane support mismatch.');
    }
    for (const q of fixture.questions) {
        if (q.claims.some(id => !fixture.claims.some(c => c.key === id && c.question === q.key)))
            throw Error('Question claim membership mismatch.');
        const scripts = fixture.scripts.filter(s => s.kind === 'oracle' && s.question === q.key);
        if (scripts.length !== 1)
            throw Error('Exactly one oracle answer must cover every question.');
        if (q.trace.length !== fixture.granularities.length * PRIHA_ROWS.length)
            throw Error('Question trace coverage is incomplete.');
        unique(q.trace.map(t => t.row + ':' + t.granularity), 'trace keys');
        for (const t of q.trace) {
            if (!fixture.granularities.some(g => g.id === t.granularity) || !PRIHA_ROWS.includes(t.row))
                throw Error('Unknown trace granularity or row.');
        }
        for (const t of q.trace)
            for (const id of [...t.retrieved, ...t.supplied])
                if (!prihaCorpus(fixture, t.granularity).chunk(id))
                    throw Error('Trace names an unknown or ineligible evidence address.');
    }
    for (const script of fixture.scripts) {
        if (!fixture.questions.some(q => q.key === script.question) || script.conversation !== null && !conversations.some(c => c.key === script.conversation) || script.webRecord !== null && !fixture.web.some(w => w.name === script.webRecord))
            throw Error('Script names an unregistered fixture member.');
    }
    for (const w of fixture.web)
        if (w.elements.some(id => elements.get(id)?.lane !== 'web' || elements.get(id)?.version !== 'web-' + w.name))
            throw Error('Web element membership mismatch.');
    for (const c of conversations) {
        const supplied = [...c.initial.facts, ...c.human.flatMap(t => t.facts)];
        unique(c.factPredicates.map(p => p.fact), 'conversation fact predicates');
        if (supplied.some(f => !c.factPredicates.some(p => p.fact === f)) || c.factPredicates.some(p => !supplied.includes(p.fact) || !matchesPredicates(p.fact, p.predicates as Predicates)))
            throw Error('Conversation fact predicates are incomplete.');
    }
    if (!equalsJson(fixture.scripts.filter(s => s.kind !== 'oracle').map(s => s.kind), PRIHA_BAD_ROWS))
        throw Error('Bad-control registration drift.');
    for (const c of fixture.conversations)
        if (!conversations.some(v => v.key === c.key))
            throw Error('Conversation registration is incomplete.');
    const replay = createPrihaReplay(fixture.web, bodies);
    for (const record of fixture.web) {
        const response = await replay.fetchFor(record.kind)(record.url);
        if (response.status !== record.status || digest(new Uint8Array(await response.arrayBuffer())) !== record.sha256)
            throw Error('Fixture replay differs from its captured response.');
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { replay: replay.stats(), fixture, fixtureId: await canonicalSha256(fixture), source: { files, sha256: await canonicalSha256({ files }) }, bodies, conversations, userFacts, localQueries, corpusAddresses, webExecution, answerExecution, flowExecution, completeExecution };
}
/** All byte-addressed pages remain in the classifier registry, including future evidence. */
export function prihaCorpus(fixture: PrihaFixture, granularity: string): EvidenceCorpus {
    const versions = new Map(fixture.sources.flatMap(s => s.versions.map(v => [v.key, v] as const))), chunks = new Map<string, EvidenceChunk>();
    for (const c of fixture.chunks.filter(c => c.granularity === granularity)) {
        const v = versions.get(c.version)!;
        chunks.set(c.key, { id: c.key, version: c.version, status: v.status, admittedAt: v.admittedAt, elements: new Set(c.elements) });
    }
    for (const w of fixture.web)
        if (w.kind === 'document' && w.status >= 200 && w.status < 300 && w.elements.length) {
            const id = 'web:' + w.sha256;
            chunks.set(id, { id, version: 'web-' + w.name, status: 'active', admittedAt: w.admittedAt, elements: new Set(w.elements) });
        }
    return { chunk: id => chunks.get(id) };
}
/** Refusals project only for the unchanged claim scorer; disposition accuracy stays three-way. */
export function prihaScoreAnswer(fixture: PrihaFixture, q: PrihaQuestion, answer: PrihaAnswer, trace: AttemptTrace, granularity: string): ReturnType<typeof scoreAnswer> {
    const expected = fixture.claims.filter(c => c.question === q.key), question: FixtureQuestion = { key: q.key, kind: q.kind === 'answerable' ? 'answerable' : 'unanswerable', text: q.text, reference: expected.length ? expected.map(c => c.reference).join(' ') : null, claims: q.claims };
    const projected: AnswerValue = answer.disposition === 'answer' ? { disposition: 'answer', claims: answer.claims } : { disposition: 'abstain', reason: answer.reason ?? 'No supported answer.', claims: [] };
    return scoreAnswer(question, expected, projected, prihaCorpus(fixture, granularity), trace, fixture.cutoff);
}
export function prihaEvidenceRecall(fixture: PrihaFixture, question: string, lane: 'local' | 'web', trace: AttemptTrace, granularity: string): number {
    const support = new Set(fixture.claims.filter(c => c.question === question).flatMap(c => fixture.supportByLane.find(s => s.claim === c.key)![lane]));
    if (!support.size)
        return 1;
    const corpus = prihaCorpus(fixture, granularity), seen = new Set(trace.retrieved.flatMap(id => [...(corpus.chunk(id)?.elements ?? [])]));
    return [...support].filter(id => seen.has(id)).length / support.size;
}
export function scorePrihaConversation(conversation: PrihaConversation, actual: PrihaConversation['oracle']) {
    const supplied = [...conversation.initial.facts, ...conversation.human.slice(0, actual.turns).flatMap(t => t.facts)];
    const available = conversation.factPredicates.filter(p => supplied.includes(p.fact));
    const invented = actual.facts.filter(f => !available.some(p => matchesPredicates(f, p.predicates as Predicates)));
    const expected = conversation.expected;
    return { triage: Number(actual.triage === expected.triage), plan: Number(actual.queries.length === expected.queries.length && expected.queries.every((p, i) => matchesPredicates(actual.queries[i], p as Predicates)) && equalsJson(actual.ruleIds, expected.ruleIds)), inventedFacts: invented.length, turns: actual.turns, resolved: Number(actual.outcome === 'resolved'), exhausted: Number(actual.outcome === 'exhausted'), correct: Number(actual.outcome === expected.outcome && actual.turns === expected.turns && invented.length === 0) };
}
export async function loadPrihaControl(root = process.cwd()): Promise<{
    control: PrihaControl;
    handoffReportId: string;
    handoffSha256: string;
    flatRetrieval: ReportSchema['registration']['flatRetrieval'];
}> {
    const bytes = await readFile(join(root, 'benchmark/results/grounding-handoff.json')), value = JSON.parse(bytes.toString('utf8'));
    if (value.document !== 'grounding-handoff')
        throw Error('PriHA requires the immutable grounding-handoff document.');
    const validateControl = createReportValidator(groundingSchema, [identitySchema]);
    if (!validateControl(value).valid)
        throw Error('The immutable grounding handoff does not validate.');
    const { reportId, ...payload } = value;
    if (reportId !== await canonicalSha256(payload))
        throw Error('The immutable grounding handoff report identity does not match its bytes.');
    const control = Object.fromEntries(['reportId', 'registrationId', 'fixtureId', 'sourceSha256', 'configIdentityId'].map(k => [k, value.handoff.identities[k]])) as unknown as PrihaControl;
    if (Object.values(control).some(v => typeof v !== 'string' || !(/^[0-9a-f]{64}$/).test(v)))
        throw Error('The immutable grounding handoff lacks a baseline identity.');
    return { control, handoffReportId: value.reportId, handoffSha256: digest(bytes), flatRetrieval: value.handoff.flatRow.retrieval };
}
const average = (values: number[]) => mean(values) ?? 0;
const emptyWeb = () => ({ searches: 0, results: 0, snippets: 0, admitted: 0, denied: 0, redirectsOutOfPolicy: 0, fetched: 0, failed: 0, bytes: 0, stopReason: null });
const emptyClarification = () => ({ turns: 0, resolved: 0, exhausted: 0, 'invented-facts': 0 });
const emptySafety = () => ({ 'emergency-routed': 0, 'out-of-scope-refused': 0, 'safelist-bypass': 0, 'fabricated-url': 0, 'unsupported-critical': 0 });
const absent = (reason: string) => ({ status: 'implementation-missing' as const, reason, cases: 0 });
function missingPrihaRow(key: PrihaRow['key'], planned: number): PrihaRow {
    const reason = key === 'flat-semantic' || key === 'local-hybrid' ? 'The registered local retrieval capability is not implemented.' : key === 'web-only' ? 'The safelisted web retrieval capability is not implemented.' : key === 'drag-no-optimizer' ? 'Dual retrieval and reconciliation are not implemented.' : 'The clarification, dual retrieval and composed workflow capabilities are not implemented.';
    return { key, status: 'implementation-missing', reason, retrieval: absent(reason), optimizer: absent('The clarification/plan census is not implemented.'), answer: absent('Claim generation and reconciliation are not implemented.'), flow: absent('The composed grounding workflow is not implemented.'), metrics: null, cases: [], counts: { planned, answered: 0, abstained: 0, refused: 0, failed: 0, notRun: planned }, web: emptyWeb(), clarification: emptyClarification(), safety: emptySafety(), cost: emptyTally(), latency: latency([]) };
}
export function scorePrihaBadRows(loaded: LoadedPrihaFixture): PrihaBadRow[] {
    const f = loaded.fixture;
    return PRIHA_BAD_ROWS.map(key => {
        const script = f.scripts.find(s => s.kind === key)!, q = f.questions.find(q => q.key === script.question)!, answer = script.answer as PrihaAnswer;
        const trace = { retrieved: answer.claims.flatMap(c => c.citations), supplied: answer.claims.flatMap(c => c.citations) }, scored = prihaScoreAnswer(f, q, answer, trace, 'flat-450');
        let actual = 'control-did-not-fire', expected: string, count = 0, refusals = 0, inventedFacts = 0, decisionMismatches = 0;
        if (key === 'snippet-as-evidence' || key === 'fabricated-url' || key === 'future-dated-page') {
            expected = key === 'future-dated-page' ? 'future-evidence' : 'unknown-evidence';
            actual = scored.citations[0]?.outcome ?? 'no-citation';
            count = scored.citations.filter(c => c.outcome === expected).length;
        }
        else if (key === 'redirect-out-of-policy') {
            expected = 'policy-denied';
            const row = f.web.find(w => w.name === script.webRecord);
            if (row?.redirectTo && !f.safelist.includes(new URL(row.redirectTo).hostname)) {
                actual = 'policy-denied';
                count = 1;
            }
        }
        else if (key === 'unsupported-critical') {
            expected = 'refusal';
            if (q.critical && scored.claims.fp > 0) {
                actual = 'refusal';
                refusals = count = 1;
            }
        }
        else if (key === 'stale-local-preferred') {
            expected = 'decision-mismatch';
            if (script.decision !== q.decision) {
                actual = 'decision-mismatch';
                decisionMismatches = count = 1;
            }
        }
        else if (key === 'invented-user-fact') {
            expected = 'invented-fact';
            const conversation = loaded.conversations.find(c => c.key === script.conversation)!;
            inventedFacts = scorePrihaConversation(conversation, { ...conversation.oracle, facts: script.facts }).inventedFacts;
            if (inventedFacts) {
                actual = 'invented-fact';
                count = inventedFacts;
            }
        }
        else {
            expected = 'exhausted';
            const conversation = loaded.conversations.find(c => c.key === script.conversation)!;
            const missing = conversation.expected.requiredFields.length > 0 && conversation.oracle.outcome === 'exhausted';
            if (missing && script.turns >= f.budgets.clarificationTurns) {
                actual = 'exhausted';
                count = 1;
            }
        }
        return { key, expected, actual, count, passed: actual === expected && count === 1, citations: scored.citations.map(c => c.outcome), fetchedBytes: 0, inventedFacts, decisionMismatches, refusals };
    });
}
function oraclePrihaRow(loaded: LoadedPrihaFixture): PrihaRow {
    const f = loaded.fixture, granularity = 'flat-450', cases: PrihaCase[] = f.questions.map(q => {
        const script = f.scripts.find(s => s.kind === 'oracle' && s.question === q.key)!, answer = script.answer as PrihaAnswer, trace = q.trace.find(t => t.row === 'oracle' && t.granularity === granularity)!, scored = prihaScoreAnswer(f, q, answer, trace, granularity);
        return { question: q.key, expected: q.kind === 'answerable' ? 'answer' : q.kind, given: answer.disposition, correctDisposition: answer.disposition === (q.kind === 'answerable' ? 'answer' : q.kind), trace: { retrieved: trace.retrieved, supplied: trace.supplied }, claims: scored.claims, citations: scored.citations, decision: script.decision!, decisionCorrect: script.decision === q.decision, localRecall: prihaEvidenceRecall(f, q.key, 'local', trace, granularity), webRecall: prihaEvidenceRecall(f, q.key, 'web', trace, granularity) };
    });
    const sum = (key: 'tp' | 'fp' | 'fn') => cases.reduce((n, c) => n + c.claims[key], 0), tp = sum('tp'), fp = sum('fp'), fn = sum('fn');
    const citations = cases.flatMap(c => c.citations), parents = f.chunks.filter(c => c.parent !== null), conversations = loaded.conversations.map(c => scorePrihaConversation(c, c.oracle));
    const metrics: PrihaMetrics = { claims: { tp, fp, fn, microPrecision: tp / (tp + fp), microRecall: tp / (tp + fn), microF1: 2 * tp / (2 * tp + fp + fn), meanF1: average(cases.filter(c => c.expected === 'answer').map(c => c.claims.f1!)) }, citationResolution: citations.filter(c => ['supporting', 'resolved-not-supporting'].includes(c.outcome)).length / citations.length, citationSupport: citations.filter(c => c.outcome === 'supporting').length / citations.length, triageAccuracy: average(conversations.map(c => c.triage)), parentRecovery: parents.filter(c => f.parents.find(p => p.key === c.parent)?.children.includes(c.key)).length / parents.length, reconciliationAccuracy: average(cases.map(c => Number(c.decisionCorrect))), abstentionAccuracy: average(cases.filter(c => c.expected === 'abstain').map(c => Number(c.correctDisposition))), refusalAccuracy: average(cases.filter(c => c.expected === 'refuse').map(c => Number(c.correctDisposition))), localRecall: average(cases.filter(c => f.claims.filter(e => e.question === c.question).some(e => f.supportByLane.find(s => s.claim === e.key)!.local.length)).map(c => c.localRecall)), webRecall: average(cases.filter(c => f.claims.filter(e => e.question === c.question).some(e => f.supportByLane.find(s => s.claim === e.key)!.web.length)).map(c => c.webRecall)) };
    const block = { status: 'analytic' as const, reason: 'Fixture ceiling; no product mechanism or provider executes.', cases: cases.length };
    return { key: 'oracle', status: 'analytic', reason: block.reason, retrieval: block, optimizer: { ...block, cases: conversations.length }, answer: block, flow: { status: 'not-run', reason: 'The analytic oracle does not execute a workflow.', cases: 0 }, metrics, cases, counts: { planned: cases.length, answered: cases.filter(c => c.given === 'answer').length, abstained: cases.filter(c => c.given === 'abstain').length, refused: cases.filter(c => c.given === 'refuse').length, failed: 0, notRun: 0 }, web: emptyWeb(), clarification: { turns: conversations.reduce((n, c) => n + c.turns, 0), resolved: conversations.reduce((n, c) => n + c.resolved, 0), exhausted: conversations.reduce((n, c) => n + c.exhausted, 0), 'invented-facts': conversations.reduce((n, c) => n + c.inventedFacts, 0) }, safety: { ...emptySafety(), 'emergency-routed': f.questions.filter(q => q.ruleIds.includes('emergency-route') && cases.find(c => c.question === q.key)?.given === 'refuse').length, 'out-of-scope-refused': f.questions.filter(q => q.ruleIds.some(id => id.startsWith('out-of-scope-')) && cases.find(c => c.question === q.key)?.given === 'refuse').length }, cost: emptyTally(), latency: latency([]) };
}
export const PRIHA_SOURCE_FILES = ['benchmark/priha.ts', 'benchmark/lib/priha.ts', 'benchmark/lib/priha-replay.ts', 'benchmark/lib/priha.types.ts', 'benchmark/lib/grounding.ts', 'benchmark/lib/grounding.types.ts', 'benchmark/lib/http-capture.ts', 'benchmark/lib/report-envelope.ts', 'benchmark/lib/source-manifest.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/locomo-parity.ts', 'benchmark/lib/locomo-policy.ts', 'benchmark/schemas/priha.schema.json', 'benchmark/schemas/grounding.schema.json', 'packages/config/schemas/run-identity.schema.json', 'package.json', 'package-lock.json'];
export async function buildPrihaReport(options: {
    root?: string;
    loaded?: LoadedPrihaFixture;
    source?: SourceManifest;
    onLocalTiming?: (value: PrihaLocalTiming) => void;
} = {}): Promise<PrihaReport> {
    const root = options.root ?? process.cwd(), loaded = options.loaded ?? await loadPrihaFixture(root), f = loaded.fixture, control = await loadPrihaControl(root);
    const measuredSource = options.source ?? await sourceManifest(root, PRIHA_SOURCE_FILES, ['benchmark/lib', 'packages', 'apps/desktop/src']), source: SourceManifest = { files: measuredSource.files, sha256: await canonicalSha256({ files: measuredSource.files }) };
    const profile = await contractProfile();
    if (profile.revision !== f.profileRevision) throw Error('PriHA registered profile revision differs from the shipped profile.');
    unique(f.profileRuleInputs.map(input => input.conversation), 'profile rule input');
    const rules: PrihaContractProbe[] = f.profileRuleInputs.flatMap(input => {
        const conversation = loaded.conversations.find(c => c.key === input.conversation);
        if (!conversation) throw Error('PriHA profile rule input names a missing conversation.');
        const result = evaluateProfileRules(profile, { text: conversation.initial.text, intents: input.intents });
        const actual = [result.emergency, result.outOfScope, ...result.expansions.map(e => e.ruleId)].filter(id => id !== null).join(',');
        const expected = conversation.expected.ruleIds.join(',');
        const rows = [{ id: 'rule:' + input.conversation, actual, expected, passed: actual === expected }];
        if (result.expansions.length) {
            const queries = result.expansions.flatMap(e => e.queries);
            const queryMatch = queries.length === conversation.expected.queries.length && queries.every((query, i) => matchesPredicates(query, conversation.expected.queries[i] as Predicates));
            rows.push({ id: 'expansion-query:' + input.conversation, actual: String(queryMatch), expected: 'true', passed: queryMatch });
        }
        return rows;
    });
    const stores = await measurePrihaStoreContracts(), probes = [...rules, ...stores.memory, ...stores.sqlite];
    const contracts = { status: 'executed' as const, profileRevision: profile.revision, rules, ...stores, passed: probes.filter(p => p.passed).length, failed: probes.filter(p => !p.passed).length, providerRequests: 0 as const };
    const local = await measurePrihaLocal(loaded, profile, options.onLocalTiming);
    const optimizer = await measurePrihaOptimizer(loaded.conversations, profile, loaded.userFacts);
    const web = await measurePrihaWeb(loaded, profile);
    const answerMeasurement = await measurePrihaAnswers(loaded), answers = answerMeasurement.report;
    const flow = await measurePrihaFlow(loaded, answerMeasurement);
    const ablation = await measurePrihaAblation(loaded), safety = await measurePrihaSafety(loaded), pairing = prihaPairing(loaded, flow, ablation);
    const decision = decidePriha(loaded, flow, answers, ablation, safety, pairing);
    const registrationBody = { completeExecutionId: ablation.executionId, contextTokens: 1500 as const, flowExecutionId: flow.executionId, answerExecutionId: answers.executionId, answerProfileRevision: answers.profileRevision, webExecutionId: web.executionId, optimizerCatalogRevision: optimizer.catalogRevision, optimizerVocabularyRevision: optimizer.vocabularyRevision, localCorpusAddressId: local.corpusAddressId, localQueryId: local.queryId, fixtureId: loaded.fixtureId, ...control, questionIds: f.questions.map(q => q.key), budgets: f.budgets, corpusVersions: f.sources.flatMap(s => s.versions.map(v => v.key)), granularities: f.granularities, rankerId: 'rrf/1' as const, profile: { id: profile.id, revision: profile.revision }, promptIdentity: null, modelIdentity: null, hypothesis: f.hypothesis, capabilityRows: PRIHA_CAPABILITY_ROWS.map(c => ({ capability: c.capability, requirements: [...c.requirements] })) };
    const registration = { ...registrationBody, registrationId: await canonicalSha256(registrationBody) };
    const live = await planPrihaLive({ registration, source }, undefined, { loaded });
    const oracle = oraclePrihaRow(loaded), rows = [oracle, ...PRIHA_ROWS.slice(1).map(key => missingPrihaRow(key, f.questions.length))], badRows = scorePrihaBadRows(loaded), m = oracle.metrics!;
    for (const row of rows) if (row.key === 'flat-semantic' || row.key === 'local-hybrid') {
        row.status = 'not-run'; row.reason = 'Retrieval executes; claim generation and the complete workflow are not yet implemented.';
        row.retrieval = { status: 'executed', reason: null, cases: local.queries.length };
    }
    for (const row of rows) if (row.key === 'drag-no-optimizer' || row.key === 'priha-full') {
        row.status = 'not-run'; row.reason = 'Scripted planning and the web component execute separately; claim generation and the complete workflow remain unexecuted.';
        row.optimizer = { status: 'executed', reason: 'Scripted plan census only; no answer-quality measurement.', cases: loaded.conversations.length };
    }
    for (const row of rows) if (['web-only', 'drag-no-optimizer', 'priha-full'].includes(row.key)) {
        row.status = 'not-run'; row.reason = 'The web component executes independently; full answer and workflow measurements remain unexecuted.';
        row.retrieval = { status: 'executed', reason: 'Registered web component and controls only; no answer-quality measurement.', cases: web.rows[0]!.cases.length };
    }
    for (const measured of answerMeasurement.treatments) Object.assign(rows.find(row => row.key === measured.key)!, measured);
    for (const measured of flow.rows) {
        const row = rows.find(row => row.key === measured.key)!;
        row.flow = { status: 'executed', reason: null, cases: measured.runs.length }; row.cases = measured.cases as PrihaCase[]; row.metrics = measured.metrics as PrihaMetrics;
        row.cost = { ...(row.cost as ReturnType<typeof emptyTally>), turns: measured.calls, tokens: measured.tokens };
    }
    const observations = { supportedClaimPrecision: m.claims.microPrecision, supportedClaimRecall: m.claims.microRecall, supportedClaimF1: m.claims.microF1, citationResolution: m.citationResolution, citationSupport: m.citationSupport, triage: m.triageAccuracy, parentRecovery: m.parentRecovery, reconciliation: m.reconciliationAccuracy, abstention: m.abstentionAccuracy, refusal: m.refusalAccuracy };
    const clauses = Object.entries(observations).map(([metric, actual]) => ({ metric, expected: 1, actual, passed: actual === 1 })), failures = [...clauses.filter(c => !c.passed).map(c => c.metric + ' ceiling failed'), ...badRows.filter(r => !r.passed).map(r => r.key + ' terminal control failed')], gate = { passed: failures.length === 0, clauses, failures };
    const capabilities = PRIHA_CAPABILITY_ROWS.map(c => ({ id: c.capability, passed: c.capability === 'instrument' ? gate.passed : c.capability === 'contracts' ? contracts.failed === 0 : c.capability === 'local' ? local.failed === 0 : c.capability === 'optimizer' ? optimizer.failed === 0 : c.capability === 'web' ? web.failed === 0 : c.capability === 'reconcile' ? answers.failed === 0 : c.capability === 'flow' && flow.failed === 0, missing: c.capability === 'instrument' ? failures : c.capability === 'contracts' ? probes.filter(p => !p.passed).map(p => p.id) : c.capability === 'local' ? local.rows.filter(r => r.metrics.issues).map(r => r.key) : c.capability === 'optimizer' ? optimizer.rows.find(row => row.key === 'priha-full')!.cases.filter(row => !row.passed).map(row => row.conversation) : c.capability === 'web' ? web.rows.flatMap(row => row.cases.filter(value => !value.passed).map(value => row.key + ':' + value.id)) : c.capability === 'reconcile' ? [...answers.safety.filter(row => !row.passed).map(row => row.row + ':' + row.id), ...answers.conflicts.filter(row => !row.passed).map(row => row.id), ...answers.runs.filter(row => row.leakage || !row.reopened).map(row => row.row + ':' + row.question)] : c.capability === 'flow' ? [...flow.rows.filter(row => !row.passed).map(row => row.key), ...flow.paths.filter(row => !row.passed).map(row => row.id), ...flow.crashes.filter(row => !row.passed).map(row => row.path)] : [...c.requirements] }));
    const complete = capabilities.find(row => row.id === 'complete')!;
    complete.missing = [...capabilities.filter(row => row.id !== 'complete' && !row.passed).map(row => row.id),
        ...(ablation.failed ? ['ablation' as const] : []), ...(safety.failed ? ['safety' as const] : [])];
    complete.passed = complete.missing.length === 0;
    const localEvidence: EvidenceRow[] = f.sources.flatMap(s => s.versions.map(v => ({ id: v.key, lane: 'local' as const, version: v.key, authorityTier: v.facts.authorityTier, admittedAt: v.admittedAt, effectiveAt: v.facts.effectiveAt, expiresAt: v.facts.expiresAt, timeProvenance: v.facts.timeProvenance, sha256: v.sha256 })));
    const evidence: EvidenceRow[] = [...localEvidence, ...f.web.filter(w => w.kind === 'document').map(w => ({ id: 'web:' + w.sha256, lane: 'web' as const, version: 'web-' + w.name, authorityTier: w.facts.authorityTier, admittedAt: w.admittedAt, effectiveAt: w.facts.effectiveAt, expiresAt: w.facts.expiresAt, timeProvenance: w.facts.timeProvenance, sha256: w.sha256 }))];
    const body = { document: 'priha-report' as const, benchmark: 'priha' as const, schemaVersion: 1 as const, registration, source, fixtureSource: loaded.source, replay: loaded.replay, envelope: analyticEnvelope(PRIHA_ROWS), rows, badRows, gate, capabilities, contracts, local, optimizer, web, answers, flow, ablation, safety, pairing, decision, live, evidence, summary: { rows: rows.length, missing: rows.filter(r => r.status === 'implementation-missing').length, cases: rows.reduce((n, r) => n + r.cases.length, 0), badControls: badRows.length, failedControls: badRows.filter(r => !r.passed).length, providerRequests: 0 }, reportId: '' };
    const { reportId: _, ...payload } = body;
    body.reportId = await canonicalSha256(payload);
    mustValidate(body, 'Invalid PriHA report');
    return body;
}
export function requirePrihaCapability(report: PrihaReport, capability: string) {
    if (!PRIHA_CAPABILITIES.includes(capability as typeof PRIHA_CAPABILITIES[number]))
        throw Error('Unknown PriHA capability: ' + capability);
    if (!report.gate.passed)
        throw Error('PriHA instrument gate failed: ' + report.gate.failures.join('; '));
    const value = report.capabilities.find(c => c.id === capability)!;
    if (!value.passed)
        throw Error('PriHA ' + capability + ' requires ' + value.missing.join(', ') + '.');
}
export const renderPrihaReport = (report: PrihaReport) => JSON.stringify(report, null, 2) + '\n';
export function renderPrihaDocument(report: PrihaReport, liveReceipts: readonly PrihaLiveReceipt[] = []) {
    const c = report.registration.control;
    return ['# Governed dual retrieval benchmark', '', 'Generated by `npm run benchmark:priha`; figures are produced by the independent instrument.', '',
        'This original MIT fictional Harbour District corpus measures software behavior. It contains no real healthcare guidance. Profile rules, atomic state, flat retrieval, hybrid parent/child retrieval and the scripted optimizer execute. The safelisted web component also executes from committed bytes. Five answer treatments execute under registered scripts and an explicitly fictional jurisdiction profile. ' + (liveReceipts.length ? 'Dated live measurements are reported separately below; healthcare deployment remains unqualified.' : 'Live answer quality and healthcare deployment are unmeasured.'), '',
        table({ head: ['Treatment', 'Status', 'Reason', 'Supported-claim F1', 'Calls / tokens'], rows: report.rows.map(r => [r.key, r.status, r.reason ?? 'executed', r.metrics ? score(r.metrics.claims.microF1) : null, String((r.cost as { turns: number }).turns) + ' / ' + String((r.cost as { tokens: number }).tokens)]) }), '',
        table({ head: ['Ablation', 'Supported TP / FP / FN', 'Micro F1', 'Calls / tokens', 'Definition'], rows: report.ablation.rows.map(row => { const claims = row.metrics.claims as PrihaMetrics['claims']; return [row.key,
            [claims.tp, claims.fp, claims.fn].join(' / '), score(claims.microF1), row.calls + ' / ' + row.tokens, row.description]; }) }), '',
        `Ablations execute ${report.ablation.rows.reduce((sum, row) => sum + row.runs.length, 0)} native runs and ${report.ablation.scriptedRequests} scripted requests. Every run reopens from SQLite. The historical-weight row is an equivalence control because those weights already define the frozen full treatment; it is not a new optimized treatment. Removing reconciliation rules is explicitly experimental and changes no governed default. Higher fixture claim coverage cannot establish that removing policy rules is safe.`, '',
        table({ head: ['Treatment / control', 'Scored / gold-free questions', 'Mean paired F1 delta', '95% interval', 'Wins / losses / ties', 'Paired SD / SE / detectable effect'],
            rows: report.pairing.comparisons.map(row => [row.treatment + ' / ' + row.control, row.pairs + ' / ' + row.excludedNull, score(row.mean),
                '[' + score(row.interval.low) + ', ' + score(row.interval.high) + ']', [row.wins,row.losses,row.ties].join(' / '),
                [row.power.pairedSd,row.power.standardError,row.power.minimumDetectableEffect].map(value => score(value)).join(' / ')]) }), '',
        'Paired supported-claim F1 uses the unchanged independent scorer, 10,000 bootstrap resamples, seed 17753 and level 0.95. All 32 question outcomes remain visible: 24 gold-bearing questions enter the numeric denominator, including failed and abstained answers; eight gold-free safety questions retain null F1. A null is never converted into a successful answer or a numeric zero. The full/raw comparison isolates optimizer cost under identical answer recipes; prompt differences are not inferred from outcome differences.', '',
        table({ head: ['Safety suite', 'Cases', 'Violations', 'Registered predicate'], rows: report.safety.suites.map(row => [row.id, row.cases, row.violations, row.predicate]) }), '',
        table({ head: ['Safety case', 'Expected / visible disposition', 'Native outcome', 'Calls / requests', 'Denied reads', 'Violations'], rows: report.safety.cases.map(row => [row.id,
            row.expected + ' / ' + row.actual, row.run.disposition + (row.run.failure ? ': ' + row.run.failure : ''), row.run.calls + ' / ' + row.run.requests, row.denied, row.violations]) }), '',
        `Safety measurement: ${report.safety.scriptedRequests} scripted requests, including ${report.safety.setup.reduce((sum, row) => sum + row.calls, 0)} calls that seed a separate conversation with an actual accepted clarification fact. The planning attack is retained as a named plan-unavailable content rejection with no stored query; it is not counted as a successful plan. An initial unconditional failure check misclassified this expected rejection and was corrected without changing the registered no-leakage predicate. The fetched-instruction test measures deterministic admission of scripted tool attempts, not live-model injection resistance.`, '',
        table({ head: ['Scripted adoption clause', 'Pass'], rows: report.decision.clauses.map(row => [row.id, String(row.passed)]) }), '',
        `Decision tier: **${report.decision.tier}**; product default changed: **${report.decision.defaultChanged}**. The schema recomputes the decision clauses from the measured rows, paired outcomes, budgets, citations and safety counts.`, '',
        `Live: **${report.live.status}**. ${report.live.reason} ${report.live.skipped ?? ''} Plan \`${report.live.plan.planId}\` pins the current source, fixture, wire, replay transport and profile. Maximum ${report.live.plan.maxFreshCalls} provider calls, ${report.live.plan.maxSearches} searches and ${report.live.plan.maxFetches} fetches; ${report.live.plan.limits.maxOutputTokens} output tokens per call, one concurrent call, one wire attempt and no model cache. No provider or live-web purchase is part of this receipt.`, '',
        ...liveReceipts.flatMap(({ plan, execution }) => [
            `Dated live execution: **${execution.at}**; receipt \`${execution.executionId}\`; plan \`${plan.plan.planId}\`. Source \`${execution.sourceSha256}\` ${execution.sourceSha256 === report.source.sha256 ? 'matches' : 'differs from'} the current keyless source. ${execution.providerRequests} provider requests, ${execution.webRequests} web requests and ${execution.webBytes} delivered web bytes. Product default changed: **${execution.defaultChanged}**.`, '',
            table({ head: ['Live treatment', 'Claim F1', 'Citation resolution / support', 'Calls / tokens', 'Provider / web requests'], rows: execution.rows.map(row => [row.key,
                score((row.metrics.claims as PrihaMetrics['claims']).microF1), score(row.metrics.citationResolution) + ' / ' + score(row.metrics.citationSupport), row.calls + ' / ' + row.tokens,
                row.providerRequests + ' / ' + row.webRequests]) }), '',
            table({ head: ['Live treatment / control', 'Paired F1 delta', '95% interval', 'Scored / gold-free questions'], rows: execution.comparisons.map(row => [row.treatment + ' / ' + row.control,
                score(row.mean), '[' + score(row.interval.low) + ', ' + score(row.interval.high) + ']', row.pairs + ' / ' + row.excludedNull]) }), '', execution.limitations, '',
        ]),
        'Inspect a newly configured plan with `npm run benchmark:priha -- --live`. A separately approved execution uses `--live --authorize <plan-id> --live-json <dated-path>`; optional `--web-live --searx <base>` changes the exact plan identity and uses bounded HTTP capture. Missing credentials, rejected spend guards, a stale source or a mismatched plan cannot dispatch a request. Live clarification is retained as unfinished unless a real host responds; the runner invents no personal facts. SQLite traces and captured bodies remain under `benchmark/cache`, and dated JSON contains the exact plan, scored rows, configuration identity and capture manifest.', '',
        `Answer tier: **${report.answers.tier}**; profile revision \`${report.answers.profileRevision}\`; execution \`${report.answers.executionId}\`. ${report.answers.limitations}`, '',
        table({ head: ['Answer treatment', 'Claim precision / recall / F1', 'Citations resolved / supporting', 'Abstention / refusal accuracy', 'Unused citation leakage', 'Validation repairs'], rows: report.rows.slice(1).map(row => [row.key,
            [row.metrics!.claims.microPrecision, row.metrics!.claims.microRecall, row.metrics!.claims.microF1].map(value => score(value)).join(' / '),
            score(row.metrics!.citationResolution) + ' / ' + score(row.metrics!.citationSupport), score(row.metrics!.abstentionAccuracy) + ' / ' + score(row.metrics!.refusalAccuracy),
            report.answers.runs.filter(run => run.row === row.key).reduce((sum, run) => sum + run.leakage, 0),
            report.answers.runs.filter(run => run.row === row.key).reduce((sum, run) => sum + run.repairs, 0)]) }), '',
        `Composed workflow: ${report.flow.rows.reduce((n, row) => n + row.runs.length, 0)} treatment/question runs through the native MAS queue; ${report.flow.crashes.length} forced stage terminations and SQLite reopenings. ${report.flow.scriptedRequests} actual scripted requests, zero provider/network requests.`, '',
        table({ head: ['Flow treatment', 'Component quality/cost parity', 'Earlier quality/calls parity', 'Calls / tokens', 'Earlier tokens / correction'], rows: report.flow.rows.map(row => [row.key, String(row.componentParity), String(row.frozenQualityParity && row.frozenCallsParity), row.calls + ' / ' + row.tokens, row.oldTokens + ' / +' + row.tokenCorrection]) }), '',
        report.flow.correction + ' Earlier receipt: `' + report.flow.baselineReportId + '`.', '',
        table({ head: ['Path', 'Observed dispositions', 'Calls / requests', 'Reopens', 'Identity check', 'Duplicate calls / requests', 'Pass'], rows: report.flow.paths.map(row => [row.id, row.dispositions.join(' → '), row.calls + ' / ' + row.requests, row.reopens, String(row.identical), row.duplicateCalls + ' / ' + row.duplicateRequests, String(row.passed)]) }), '',
        `Forced-stage recovery: ${report.flow.crashes.filter(row => row.passed).length}/${report.flow.crashes.length} identical artifact sets; ${report.flow.crashes.reduce((n, row) => n + row.duplicateCalls, 0)} duplicate calls and ${report.flow.crashes.reduce((n, row) => n + row.duplicateRequests, 0)} duplicate HTTP requests. ${report.flow.crashes.reduce((n, row) => n + row.replayed, 0)} committed-attempt replay events and ${report.flow.crashes.reduce((n, row) => n + row.restored, 0)} native region/checkpoint restoration events are observed separately. Both a web path and the nested clarification path are exercised.`, '',
        table({ head: ['Reconciliation issue / control', 'Expected', 'Observed', 'Rules', 'Pass'], rows: report.answers.conflicts.map(row => [row.issue + ' / ' + row.id, row.expected, row.actual, row.ruleIds.join(', '), String(row.passed)]) }), '',
        table({ head: ['Adversarial answer control', 'Disposition / code', 'Claims visible', 'Repairs', 'Calls', 'Pass'], rows: report.answers.safety.map(row => [row.row + ' / ' + row.id, row.disposition + ' / ' + row.code, row.visibleClaims, row.repairs, row.calls, String(row.passed)]) }), '',
        `The answer measurement executes ${report.answers.runs.length} question/treatment runs, ${report.answers.safety.length} adversarial generation controls and ${report.answers.conflicts.length} reconciliation controls. All answer traces reopen from SQLite. Calls include the real scripted optimizer, web tools, interpretation, generation and repair: ${report.answers.scriptedRequests} scripted requests, including ${report.answers.controlCalls} reconciliation-control requests. Provider/network requests and unused-candidate citation leakage are zero. The deterministic clock is not a latency measurement.`, '',
        'The native envelope proves citation identity and visibility. The unchanged independent scorer assigns semantic support using frozen claim predicates and exact support quotes in observed evidence, without analytic chunk membership substituting for retrieval. Conservative conflicts can reduce answer coverage; all abstentions/refusals stay in denominators. These scripted results do not establish live quality, adoption or healthcare deployment.', '',
        `Contracts: **${report.contracts.status}** — ${report.contracts.passed} passed, ${report.contracts.failed} failed; profile \`${report.contracts.profileRevision}\`. No provider requests.`, '',
        table({ head: ['Contract binding', 'Passed / total'], rows: [['Profile rules', report.contracts.rules.filter(r => r.passed).length + ' / ' + report.contracts.rules.length], ['Memory lifecycle', report.contracts.memory.filter(r => r.passed).length + ' / ' + report.contracts.memory.length], ['SQLite lifecycle', report.contracts.sqlite.filter(r => r.passed).length + ' / ' + report.contracts.sqlite.length]] }), '',
        'Local retrieval uses the real ingester and atomic curator promotion into SQLite, then ranks retained child text against independent frozen support quotes. Query variants were frozen before retrieval scores were measured. The expired subsidy attachment has a separately registered fixture URL: its original analytic registration marked two versions active at one URL, which cannot represent a real single-active-version source. Original bytes, dates, claims and quote expectations are unchanged; the actual corpus contains twelve sources and thirteen versions. Hash embeddings are a keyless software control, not measured model quality.', '',
        table({ head: ['Retrieval row', 'Child recall@6', 'Expanded support', 'Exact name / paraphrase', 'Candidates/query', 'Dedupe / skips / over budget', 'Rebuilds / issues'], rows: report.local.rows.map(r => [r.key, score(r.metrics.childRecall), score(r.metrics.parentRecovery), score(r.metrics.exactNameRecall) + ' / ' + score(r.metrics.paraphraseRecall), r.metrics.meanCandidates.toFixed(2), [r.metrics.deduplicated, r.metrics.skipped, r.metrics.parentsOverBudget].join(' / '), r.metrics.rebuilds + ' / ' + r.metrics.issues]) }), '',
        table({ head: ['Granularity', 'Semantic', 'Lexical', 'Fused', 'Fused beats or ties both'], rows: report.local.comparisons.map(r => [r.granularity, score(r.semantic), score(r.lexical), score(r.fused), String(r.fusedBeatsOrTiesBoth)]) }), '',
        'Child recall counts support quotes wholly present in selected children of the exact registered version. Expanded support measures parent text (or the unchanged flat heading/neighbour context). Cases with no local support remain visible and are excluded from recall denominators. Parent context is deduplicated and bounded to the registered 6000-character-equivalent token budget; the flat control retains its original expansion behavior.', '',
        'Rebuild milliseconds and query p50/p95 are kept in `benchmark/receipts/priha-local-latency.json`, generated explicitly with `--latency-json`. Timing is null in this deterministic document and never presented as zero-speed execution. The receipt binds this report and source and checks the registered latency budget.', '',
        'The optimizer census executes the public query optimizer and native GMPL/MAS clarification over SQLite. Each pause closes and reopens the database; accepted host answers are projected verbatim. Prompt revisions and stage replies are registered before measurement. The raw-query control preserves deterministic refusal rules but performs no model triage, clarification or expansion. Tier: **scripted**; the figures measure software behavior, not answer quality or live model capability.', '',
        table({ head: ['Plan census', 'Triage correct / cases', 'Plan correct / cases', 'Clarification resolved / attempted', 'Turns / exhausted / invented', 'Community query present / required', 'Scripted calls / tokens'], rows: report.optimizer.rows.map(row => { const m = row.metrics; return [row.key, m.triageCorrect === null ? 'not run' : m.triageCorrect + ' / ' + m.cases, m.planCorrect + ' / ' + m.cases, m.resolvedClarifications + ' / ' + m.clarifications, [m.turns, m.exhaustedClarifications, m.inventedFacts].join(' / '), m.communityPresent + ' / ' + m.communityRequired, m.calls + ' / ' + m.tokens]; }) }), '',
        table({ head: ['Optimizer fixture', 'Triage / outcome', 'Turns', 'Calls / tokens', 'SQLite reopens / replayed nodes', 'Checks'], rows: report.optimizer.rows.find(row => row.key === 'priha-full')!.cases.map(row => [row.conversation, row.triage + ' / ' + row.outcome, row.turns, row.calls + ' / ' + row.tokens, row.reopens + ' / ' + row.replayedNodes, row.passed ? 'pass' : row.error ?? 'failed']) }), '',
        `Optimizer artifact catalog \`${report.optimizer.catalogRevision}\`; closed user-fact vocabulary \`${report.optimizer.vocabularyRevision}\`. ${report.optimizer.limitations}`, '',
        'The web component is separately executed for web-only and each DRAG treatment. Snippets never become evidence. Original capture bytes and analytic gold remain unchanged. A registered alias preserves the old search capture while matching SearxNG query-parameter order. Supplemental HTML supplies explicit future/expired dates; original pages have unknown content times and Last-Modified stays transport-only. Six hard-budget stop cases use narrower profile ceilings. Delivered stream chunks are counted even when the final chunk exceeds the byte allowance; no subsequent read is dispatched.', '',
        table({ head: ['Web component', 'Support / required', 'Admitted / denied / redirect denied / failed', 'Searches / fetches / snippets', 'Calls / tokens / bytes', 'Passed / cases', 'Replay fetches / calls / denied-origin requests'], rows: report.web.rows.map(row => { const m = row.metrics; return [row.key, m.recovered + ' / ' + m.required, [m.admitted,m.denied,m.redirectDenied,m.failed].join(' / '), [m.searches,m.fetches,m.snippets].join(' / '), [m.calls,m.tokens,m.bytes].join(' / '), m.passed + ' / ' + m.cases, [m.replayFetches,m.replayCalls,m.deniedRequests].join(' / ')]; }) }), '',
        table({ head: ['Web fixture', 'Stop', 'Evidence', 'Refined', 'Replay / time facts', 'Check'], rows: report.web.rows[0]!.cases.map(row => [row.id,row.stopReason,row.evidence.join(', ') || 'none',String(row.refined),String(row.replayIdentical) + ' / ' + String(row.timeFactsCorrect),row.passed ? 'pass' : row.error]) }), '',
        `Web execution registration \`${report.web.executionId}\`; transport \`${report.web.transportRevision}\`. ${report.web.limitations}`, '',
        table({ head: ['Oracle gate', 'Expected', 'Measured', 'Pass'], rows: report.gate.clauses.map(c => [c.metric, c.expected, c.actual, String(c.passed)]) }), '',
        table({ head: ['Bad control', 'Terminal outcome', 'Count', 'Pass'], rows: report.badRows.map(r => [r.key, r.actual, r.count, String(r.passed)]) }), '',
        'The oracle uses the existing grounding claim matcher and terminal citation classifier unchanged. A refusal projects to abstention only for that two-disposition claim scorer; the independently reported refusal and abstention accuracies retain their distinct expected dispositions. Analytic chunk/parent memberships are frozen ceiling annotations, not a product chunker execution. Web bodies are byte-addressed; discovery snippets are never citation targets.', '',
        table({ head: ['Treatment', 'Answered / abstained / refused / not run', 'Searches / fetched / denied / failed', 'Clarification turns / resolved / exhausted / invented', 'Emergency / out-of-scope / unsupported-critical'], rows: report.rows.map(r => [r.key, [r.counts.answered, r.counts.abstained, r.counts.refused, r.counts.notRun].join(' / '), [r.web.searches, r.web.fetched, r.web.denied, r.web.failed].join(' / '), [r.clarification.turns, r.clarification.resolved, r.clarification.exhausted, r.clarification['invented-facts']].join(' / '), [r.safety['emergency-routed'], r.safety['out-of-scope-refused'], r.safety['unsupported-critical']].join(' / ')]) }), '',
        `Fixture replay verification: ${report.replay.requests} requests, ${report.replay.hits} hits, ${report.replay.failed} failures, ${report.replay.bytes} bytes and ${report.replay.networkRequests} network requests. These verify committed captures; they are not a retrieval treatment.`, '',
        'Provider costs are zero for this keyless instrument. The local corpus records actual child embedding calls and retained parent counts in the report. Corpus counters are shared by variants of one granularity and are not additive across those rows. All mechanism capabilities, ablations and registered safety suites execute. Live quality, the original paper benchmark and healthcare deployment remain unmeasured.', '',
        table({ head: ['Immutable flat control identity', 'Value'], rows: Object.entries(c).map(([k, v]) => [k, v]) }), '',
        `Handoff wrapper: \`${report.registration.handoffReportId}\`; file SHA-256 \`${report.registration.handoffSha256}\`. The nested baseline identities above are read verbatim; the flat grounding report, fixture and chat path are unchanged.`, '',
        `Registered questions: ${report.registration.questionIds.length}; fixture \`${report.registration.fixtureId}\`; registration \`${report.registration.registrationId}\`.`,
        `Source \`${report.source.sha256}\`; report \`${report.reportId}\`.`, '',
        `Decision: **${report.decision.state}** — ${report.decision.reason}`, ''].join('\n');
}
export { planPrihaLive, authorizePrihaLive, runPrihaLive } from './priha-live.ts';
export async function reportIdOf(report: Omit<PrihaReport, 'reportId'> & {
    reportId?: string;
}) { const { reportId: _, ...payload } = report; return canonicalSha256(payload); }
export async function registrationIdOf(registration: Omit<PrihaReport['registration'], 'registrationId'> & {
    registrationId?: string;
}) { const { registrationId: _, ...payload } = registration; return canonicalSha256(payload); }
/** Schema counts and hashes are necessary; a retained keyless report must also reproduce its observations. */
const verifiedReproductions = createBoundedCache<string, string>(2);
export async function validatePrihaReport(value: unknown, root = process.cwd()): Promise<void> {
    mustValidate(value, 'Invalid PriHA report');
    const report = value as PrihaReport;
    if (report.reportId !== await reportIdOf(report))
        throw Error('PriHA report identity mismatch.');
    if (report.registration.registrationId !== await registrationIdOf(report.registration))
        throw Error('PriHA registration identity mismatch.');
    const loaded = await loadPrihaFixture(root), control = await loadPrihaControl(root);
    const manifest = await sourceManifest(root, PRIHA_SOURCE_FILES, ['benchmark/lib', 'packages', 'apps/desktop/src']);
    const source = { files: manifest.files, sha256: await canonicalSha256({ files: manifest.files }) };
    if (!equalsJson(report.source, source) || !equalsJson(report.fixtureSource, loaded.source))
        throw Error('PriHA report does not reproduce the current source and fixture.');
    const key = await canonicalSha256({ source, fixture: loaded.source, control });
    let expected = verifiedReproductions.get(key);
    if (expected === undefined) {
        // Only verification reuses an independently reproduced immutable string. Every measurement still executes.
        expected = renderPrihaReport(await buildPrihaReport({ root, loaded, source }));
        verifiedReproductions.set(key, expected);
    }
    if (!equalsJson(value, JSON.parse(expected)))
        throw Error('PriHA report does not reproduce the registered fixture and source.');
}
