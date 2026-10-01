/** Independent dual-retrieval fixture and measurement over the unchanged claim scorer. */
import { createPrihaReplay } from './priha-replay.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { estimateTokens } from '@tangleai/core/tokens';
import { createReportValidator, describeErrors } from './validate.ts';
import { captureKeyOf, CAPTURED_HEADERS } from './http-capture.ts';
import { scoreAnswer, matchesPredicates, type EvidenceCorpus, type EvidenceChunk, type AttemptTrace } from './grounding.ts';
import type { FixtureClaim, FixtureQuestion, AnswerValue, Predicates, SourceManifest, LiveClaims } from './grounding.types.ts';
import type { PrihaFixture as FixtureSchema, PrihaQuestion, PrihaConversation, PrihaFixtureAnswer as AnswerSchema, PrihaRow as RowSchema, PrihaCase as CaseSchema, PrihaMetrics as MetricsSchema, PrihaReport as ReportSchema, PrihaBadRow, PrihaControl, EvidenceRow, PrihaLivePlan } from './priha.types.ts';
import schema from '../schemas/priha.schema.json' with { type: 'json' };
import groundingSchema from '../schemas/grounding.schema.json' with { type: 'json' };
import identitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import { mean } from '@jarenjs/core/stats';
import { analyticEnvelope } from './report-envelope.ts';
import { sourceManifest } from './source-manifest.ts';
import { emptyTally } from './grounding-run.ts';
import { latency } from './stats.ts';
import { table, score } from './table.ts';
import { readAiEnv, type AiEnv } from './ai-env.ts';
import { wireDescriptorOf, countingFetch } from './grounding-run.ts';
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
    const conversations: PrihaConversation[] = [];
    for (const row of fixture.conversations) {
        const value = JSON.parse(new TextDecoder().decode(await load(row.file, row.sha256))) as PrihaConversation;
        mustValidate(value, 'Invalid conversation');
        if (value.key !== row.key)
            throw Error('Conversation identity mismatch.');
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
    return { replay: replay.stats(), fixture, fixtureId: await canonicalSha256(fixture), source: { files, sha256: await canonicalSha256({ files }) }, bodies, conversations };
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
} = {}): Promise<PrihaReport> {
    const root = options.root ?? process.cwd(), loaded = options.loaded ?? await loadPrihaFixture(root), f = loaded.fixture, control = await loadPrihaControl(root);
    const measuredSource = options.source ?? await sourceManifest(root, PRIHA_SOURCE_FILES, ['benchmark/lib', 'packages', 'apps/desktop/src']), source: SourceManifest = { files: measuredSource.files, sha256: await canonicalSha256({ files: measuredSource.files }) };
    const registrationBody = { fixtureId: loaded.fixtureId, ...control, questionIds: f.questions.map(q => q.key), budgets: f.budgets, corpusVersions: f.sources.flatMap(s => s.versions.map(v => v.key)), granularities: f.granularities, rankerId: 'rrf/1' as const, profile: { id: 'priha-hk', revision: null }, promptIdentity: null, modelIdentity: null, hypothesis: f.hypothesis, capabilityRows: PRIHA_CAPABILITY_ROWS.map(c => ({ capability: c.capability, requirements: [...c.requirements] })) };
    const registration = { ...registrationBody, registrationId: await canonicalSha256(registrationBody) };
    const oracle = oraclePrihaRow(loaded), rows = [oracle, ...PRIHA_ROWS.slice(1).map(key => missingPrihaRow(key, f.questions.length))], badRows = scorePrihaBadRows(loaded), m = oracle.metrics!;
    const observations = { supportedClaimPrecision: m.claims.microPrecision, supportedClaimRecall: m.claims.microRecall, supportedClaimF1: m.claims.microF1, citationResolution: m.citationResolution, citationSupport: m.citationSupport, triage: m.triageAccuracy, parentRecovery: m.parentRecovery, reconciliation: m.reconciliationAccuracy, abstention: m.abstentionAccuracy, refusal: m.refusalAccuracy };
    const clauses = Object.entries(observations).map(([metric, actual]) => ({ metric, expected: 1, actual, passed: actual === 1 })), failures = [...clauses.filter(c => !c.passed).map(c => c.metric + ' ceiling failed'), ...badRows.filter(r => !r.passed).map(r => r.key + ' terminal control failed')], gate = { passed: failures.length === 0, clauses, failures };
    const capabilities = PRIHA_CAPABILITY_ROWS.map(c => ({ id: c.capability, passed: c.capability === 'instrument' && gate.passed, missing: c.capability === 'instrument' ? failures : [...c.requirements] }));
    const localEvidence: EvidenceRow[] = f.sources.flatMap(s => s.versions.map(v => ({ id: v.key, lane: 'local' as const, version: v.key, authorityTier: v.facts.authorityTier, admittedAt: v.admittedAt, effectiveAt: v.facts.effectiveAt, expiresAt: v.facts.expiresAt, timeProvenance: v.facts.timeProvenance, sha256: v.sha256 })));
    const evidence: EvidenceRow[] = [...localEvidence, ...f.web.filter(w => w.kind === 'document').map(w => ({ id: 'web:' + w.sha256, lane: 'web' as const, version: 'web-' + w.name, authorityTier: w.facts.authorityTier, admittedAt: w.admittedAt, effectiveAt: w.facts.effectiveAt, expiresAt: w.facts.expiresAt, timeProvenance: w.facts.timeProvenance, sha256: w.sha256 }))];
    const body = { document: 'priha-report' as const, benchmark: 'priha' as const, schemaVersion: 1 as const, registration, source, fixtureSource: loaded.source, replay: loaded.replay, envelope: analyticEnvelope(PRIHA_ROWS), rows, badRows, gate, capabilities, pairing: { eligible: false, reasons: [{ code: 'implementation-missing', detail: 'No mechanism row has executed on the registered corpus.' }], comparisons: [] }, decision: { state: 'not-evaluated' as const, clauses: [{ id: 'mechanisms-executed', passed: false }, { id: 'independent-claim-delta', passed: false }], reason: 'The analytic oracle qualifies the instrument only. Five named mechanisms are missing; live quality and healthcare deployment are unmeasured.' }, evidence, summary: { rows: rows.length, missing: rows.filter(r => r.status === 'implementation-missing').length, cases: rows.reduce((n, r) => n + r.cases.length, 0), badControls: badRows.length, failedControls: badRows.filter(r => !r.passed).length, providerRequests: 0 }, reportId: '' };
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
export function renderPrihaDocument(report: PrihaReport) {
    const c = report.registration.control;
    return ['# Governed dual retrieval benchmark', '', 'Generated by `npm run benchmark:priha`; figures are produced by the independent instrument.', '',
        'This original MIT fictional Harbour District corpus measures software behavior. It contains no real healthcare guidance. No PriHA mechanism is implemented in this measurement; live answer quality and healthcare deployment are unmeasured.', '',
        table({ head: ['Treatment', 'Status', 'Reason', 'Supported-claim F1', 'Calls / tokens'], rows: report.rows.map(r => [r.key, r.status, r.reason ?? 'executed', r.metrics ? score(r.metrics.claims.microF1) : null, '0 / 0']) }), '',
        table({ head: ['Oracle gate', 'Expected', 'Measured', 'Pass'], rows: report.gate.clauses.map(c => [c.metric, c.expected, c.actual, String(c.passed)]) }), '',
        table({ head: ['Bad control', 'Terminal outcome', 'Count', 'Pass'], rows: report.badRows.map(r => [r.key, r.actual, r.count, String(r.passed)]) }), '',
        'The oracle uses the existing grounding claim matcher and terminal citation classifier unchanged. A refusal projects to abstention only for that two-disposition claim scorer; the independently reported refusal and abstention accuracies retain their distinct expected dispositions. Analytic chunk/parent memberships are frozen ceiling annotations, not a product chunker execution. Web bodies are byte-addressed; discovery snippets are never citation targets.', '',
        table({ head: ['Treatment', 'Answered / abstained / refused / not run', 'Searches / fetched / denied / failed', 'Clarification turns / resolved / exhausted / invented', 'Emergency / out-of-scope / unsupported-critical'], rows: report.rows.map(r => [r.key, [r.counts.answered, r.counts.abstained, r.counts.refused, r.counts.notRun].join(' / '), [r.web.searches, r.web.fetched, r.web.denied, r.web.failed].join(' / '), [r.clarification.turns, r.clarification.resolved, r.clarification.exhausted, r.clarification['invented-facts']].join(' / '), [r.safety['emergency-routed'], r.safety['out-of-scope-refused'], r.safety['unsupported-critical']].join(' / ')]) }), '',
        `Fixture replay verification: ${report.replay.requests} requests, ${report.replay.hits} hits, ${report.replay.failed} failures, ${report.replay.bytes} bytes and ${report.replay.networkRequests} network requests. These verify committed captures; they are not a retrieval treatment.`, '',
        'All costs are zero for analytic or missing rows. No provider or retrieval mechanism executed. Latency is unmeasured, never a zero-speed performance claim. Missing mechanisms fail their registered capability gate; only the instrument capability currently passes.', '',
        table({ head: ['Immutable flat control identity', 'Value'], rows: Object.entries(c).map(([k, v]) => [k, v]) }), '',
        `Handoff wrapper: \`${report.registration.handoffReportId}\`; file SHA-256 \`${report.registration.handoffSha256}\`. The nested baseline identities above are read verbatim; the flat grounding report, fixture and chat path are unchanged.`, '',
        `Registered questions: ${report.registration.questionIds.length}; fixture \`${report.registration.fixtureId}\`; registration \`${report.registration.registrationId}\`.`,
        `Source \`${report.source.sha256}\`; report \`${report.reportId}\`.`, '',
        `Decision: **${report.decision.state}** — ${report.decision.reason}`, ''].join('\n');
}
export async function planPrihaLive(report: PrihaReport, env: AiEnv = readAiEnv({})) {
    if (env.baseUrl) {
        let url: URL;
        try {
            url = new URL(env.baseUrl);
        }
        catch {
            throw Error('PriHA live base URL is invalid.');
        }
        if (url.username || url.password || url.search || url.hash)
            throw Error('PriHA live base URL must be credential-free, without query or fragment.');
    }
    const wire = wireDescriptorOf(env, 'off'), body = { registrationId: report.registration.registrationId, sourceSha256: report.source.sha256, wire, rows: PRIHA_ROWS.filter((key): key is Exclude<typeof key, 'oracle'> => key !== 'oracle'), questionIds: report.registration.questionIds, budget: report.registration.budgets, maxFreshCalls: report.registration.questionIds.length * (PRIHA_ROWS.length - 1) * report.registration.budgets.modelCalls, cacheHits: 0 as const };
    const counted = countingFetch(async () => { throw Error('A PriHA dry plan reached a transport.'); });
    const plan: PrihaLivePlan = { document: 'priha-live-plan' as const, status: 'not-run' as const, plan: { ...body, planId: await canonicalSha256(body) }, physicalRequests: Object.values(counted.counts).reduce((a, b) => a + b, 0), reason: 'No executable mechanism row; this plan authorizes no request.', skipped: env.live ? null : 'No configured live wire in the shared AI environment.' };
    mustValidate(plan, 'Invalid PriHA live plan');
    return plan;
}
export function authorizePrihaLive(plan: Awaited<ReturnType<typeof planPrihaLive>>, authorize?: string) {
    if (authorize !== undefined && authorize !== plan.plan.planId)
        throw Error('PriHA authorization does not match the current planId; zero requests.');
    if (authorize !== undefined)
        throw Error('PriHA has no executable mechanism row; zero requests.');
    return plan.skipped ? 'skipped' : 'dry-run';
}
export async function reportIdOf(report: Omit<PrihaReport, 'reportId'> & {
    reportId?: string;
}) { const { reportId: _, ...payload } = report; return canonicalSha256(payload); }
export async function registrationIdOf(registration: Omit<PrihaReport['registration'], 'registrationId'> & {
    registrationId?: string;
}) { const { registrationId: _, ...payload } = registration; return canonicalSha256(payload); }
/** Schema counts and hashes are necessary; a retained keyless report must also reproduce its observations. */
export async function validatePrihaReport(value: unknown, root = process.cwd()): Promise<void> {
    mustValidate(value, 'Invalid PriHA report');
    const report = value as PrihaReport;
    if (report.reportId !== await reportIdOf(report))
        throw Error('PriHA report identity mismatch.');
    if (report.registration.registrationId !== await registrationIdOf(report.registration))
        throw Error('PriHA registration identity mismatch.');
    const measured = await buildPrihaReport({ root });
    if (!equalsJson(value, measured))
        throw Error('PriHA report does not reproduce the registered fixture and source.');
}
