/** Registered scripted answer treatments over real corpus, optimizer and replay web owners. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createBudgetAccount } from '@tangleai/agents';
import { createSharedBudgetClient, type MasChatClient } from '@tangleai/mas';
import { createGroundingStore, openTangleDb } from '@tangleai/store';
import { createLocalRetriever, createRrfRanker, projectLocalEvidence, createWebLane, createReplayWebTransport, createQueryOptimizer,
    reconcileEvidence, createAnswerModel, interpretEvidenceConflicts, generateGroundedClaims, groundingArtifacts, groundingIdOf, loadGroundingProfile, evaluateProfileRules,
    type EvidenceCandidate, type EvidenceConflict, type GroundingSession, type QueryPlan, type GroundingProfile, type PrihaAnswer,
    type WebReplayRecord, type ReconciliationFact } from '@tangleai/grounding';
import { collectDocumentEvidence, GROUNDING_DEFAULTS } from '../../apps/desktop/src/grounding.ts';
import { createPrihaCorpus } from './priha-local.ts';
import { prihaWebReplayRecords } from './priha-replay.ts';
import { contractMust, createPrihaContractFixture } from './priha-contracts.ts';
import { scoreAnswer, type EvidenceChunk, type AnswerValue } from './grounding.ts';
import { emptyTally } from './grounding-run.ts';
import type { LoadedPrihaFixture, PrihaRow, PrihaCase, PrihaMetrics } from './priha.ts';
import type { PrihaAnswerReport, PrihaAnswerRun, PrihaAnswerScript, PrihaAnswerExecution, PrihaAnswerSafety, PrihaConflictObservation, PrihaWebStep } from './priha.types.ts';

type Host = Awaited<ReturnType<typeof createPrihaCorpus>>;
type Treatment = PrihaAnswerExecution['rows'][number];
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim();
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const rate = (count: number, total: number) => total ? count / total : 0;
export function stageOf(request: unknown, registration: PrihaAnswerExecution) {
    const messages = (request as { messages: Array<{ role?: string; content: unknown }> }).messages;
    const artifact = groundingArtifacts.prompts.find(prompt => messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes(prompt.role.instructions)));
    if (!artifact || !registration.prompts.some(pin => pin.id === artifact.id && pin.revision === artifact.revision)) throw Error('Unregistered answer-stage prompt.');
    return artifact.id.replace('grounding-', '');
}
export function versionOf(candidate: EvidenceCandidate, host: Host, loaded: LoadedPrihaFixture): string {
    if ('versionId' in candidate.address) return host.versionKeys.get(candidate.address.versionId) ?? 'unregistered';
    const address = candidate.address;
    const record = [...loaded.fixture.web, ...loaded.answerExecution.webControls.records].find(record => record.sha256 === address.sha256 && record.url === address.finalUrl);
    return record ? 'web-' + record.name : 'unregistered';
}
export function bindRecipe(script: PrihaAnswerScript, candidates: EvidenceCandidate[], host: Host, loaded: LoadedPrihaFixture): PrihaAnswer {
    const recipe = script.generation;
    if (recipe.disposition !== 'answer') return { disposition: recipe.disposition, reason: recipe.reason, claims: [] };
    const claims = recipe.claims.map(claim => ({ id: claim.id, text: claim.text, critical: claim.critical, caveats: claim.caveats,
        citations: claim.citations.map(selector => candidates.find(candidate => candidate.lane === selector.lane
            && versionOf(candidate, host, loaded) === selector.version && normalized(candidate.excerpt).includes(normalized(selector.quote)))?.id) }));
    if (claims.some(claim => !claim.citations.length || claim.citations.some(id => !id)))
        return { disposition: 'abstain', reason: 'The registered claim template has no matching admitted evidence.', claims: [] };
    return { disposition: 'answer', claims: claims.map(claim => ({ ...claim, citations: claim.citations as string[] })) };
}
async function manualPlan(host: Host, profile: GroundingProfile, session: GroundingSession, query: string, lanes: { local: boolean; web: boolean }) {
    const f = await createPrihaContractFixture(profile, session);
    f.intent.originalQuery = query; f.intent.summary = query; f.intent.id = await groundingIdOf('intent', { sessionId: session.id, query });
    f.plan.intentId = f.intent.id; f.plan.queries = [{ id: await groundingIdOf('query', { sessionId: session.id, query }), text: query, why: 'Registered raw atomic question.', lanes, ruleIds: ['in-scope'] }];
    f.plan.profileRevision = profile.revision; f.plan.id = await groundingIdOf('plan', { intentId: f.intent.id, queries: f.plan.queries });
    contractMust(await host.grounding.putIntent(f.intent)); contractMust(await host.grounding.putPlan(f.plan));
    session = contractMust(await host.grounding.transitionSession(session.id, { kind: 'triage' }, session.revision));
    session = contractMust(await host.grounding.transitionSession(session.id, { kind: 'plan', intentId: f.intent.id, planId: f.plan.id }, session.revision));
    return { session, plan: f.plan };
}
export async function localCandidates(host: Host, profile: GroundingProfile, session: GroundingSession, query: QueryPlan['queries'][number], flat: boolean, cutoff: string) {
    if (!flat) {
        const retriever = createLocalRetriever({ store: host.store, manifests: host.grounding, session, embedder: host.embedder,
            ranker: createRrfRanker(), budgets: { contextTokens: 1500 }, now: () => cutoff, clock: () => 0 });
        const result = await retriever.retrieve(query, { ...GROUNDING_DEFAULTS, contextTokens: 1500 });
        if (!result.ok) throw Error(JSON.stringify(result.issue)); return result.candidates;
    }
    const [vector] = await host.embedder.embed([query.text]);
    const result = await collectDocumentEvidence(host.store, vector, { model: host.embedder.model, dims: 128 }, GROUNDING_DEFAULTS);
    if (!result.ok) throw Error(JSON.stringify(result.error));
    return Promise.all(result.evidence.ranked.map(async (row, index) => projectLocalEvidence({ session, queryId: query.id, chunk: row.chunk,
        source: row.source, manifest: await host.grounding.getManifest(row.source.id, row.chunk.versionId),
        excerpt: result.evidence.blocks[index]!.text, scores: { semantic: row.score, rank: index + 1 }, rankerId: 'cosine/1', at: cutoff })));
}
export async function reconciliationFacts(candidates: EvidenceCandidate[], host: Host, loaded: LoadedPrihaFixture) {
    const facts: Record<string, ReconciliationFact> = {};
    for (const candidate of candidates) {
        const version = versionOf(candidate, host, loaded), topic = loaded.answerExecution.topics.find(row => row.version === version)?.topic ?? version;
        if ('versionId' in candidate.address) {
            const manifest = await host.grounding.getManifest(candidate.address.sourceId, candidate.address.versionId);
            const retained = await host.store.getVersion(candidate.address.versionId);
            facts[candidate.id] = { jurisdiction: manifest!.jurisdiction, versionStatus: retained!.status, topics: [topic] };
        } else facts[candidate.id] = { topics: [topic] }; // Runtime pages do not inherit analytic jurisdiction annotations.
    }
    return facts;
}
export function corpusFor(candidates: EvidenceCandidate[], host: Host, loaded: LoadedPrihaFixture) {
    const entries = new Map<string, EvidenceChunk>();
    for (const candidate of candidates) {
        const version = versionOf(candidate, host, loaded), local = loaded.fixture.sources.flatMap(source => source.versions).find(row => row.key === version);
        const web = loaded.fixture.web.find(row => 'web-' + row.name === version);
        entries.set(candidate.id, { id: candidate.id, version, status: local?.status ?? 'active', admittedAt: local?.admittedAt ?? web?.admittedAt ?? candidate.admitted.at,
            elements: new Set(loaded.fixture.elements.filter(element => element.version === version && normalized(candidate.excerpt).includes(normalized(element.quote))).map(element => element.key)) });
    }
    return { chunk: (id: string) => entries.get(id) };
}
export function metrics(cases: PrihaCase[]): PrihaMetrics {
    const sum = (key: 'tp' | 'fp' | 'fn') => cases.reduce((value, row) => value + row.claims[key], 0), tp = sum('tp'), fp = sum('fp'), fn = sum('fn');
    const citations = cases.flatMap(row => row.citations);
    return { claims: { tp, fp, fn, microPrecision: rate(tp, tp + fp), microRecall: rate(tp, tp + fn), microF1: rate(2 * tp, 2 * tp + fp + fn), meanF1: average(cases.filter(row => row.expected === 'answer').map(row => row.claims.f1 ?? 0)) },
        citationResolution: rate(citations.filter(row => ['supporting', 'resolved-not-supporting'].includes(row.outcome)).length, citations.length),
        citationSupport: rate(citations.filter(row => row.outcome === 'supporting').length, citations.length), triageAccuracy: 0, parentRecovery: average(cases.map(row => row.localRecall)),
        reconciliationAccuracy: average(cases.map(row => Number(row.decisionCorrect))), abstentionAccuracy: average(cases.filter(row => row.expected === 'abstain').map(row => Number(row.correctDisposition))),
        refusalAccuracy: average(cases.filter(row => row.expected === 'refuse').map(row => Number(row.correctDisposition))), localRecall: average(cases.map(row => row.localRecall)), webRecall: average(cases.map(row => row.webRecall)) };
}

export function scoreRuntimeAnswer(host: Host, loaded: LoadedPrihaFixture, q: LoadedPrihaFixture['fixture']['questions'][number],
    answer: Pick<import('@tangleai/grounding').GroundedAnswer, 'disposition' | 'claims' | 'citations' | 'reason'>,
    candidates: EvidenceCandidate[], admitted: EvidenceCandidate[]) {
    const corpus = corpusFor(candidates, host, loaded);
    const actualTrace = { retrieved: candidates.map(row => row.id), supplied: admitted.map(row => row.id) };
    const projected: AnswerValue = answer.disposition === 'answer' ? { disposition: 'answer', claims: answer.claims.map(claim => ({ id: claim.id, text: claim.text, citations: claim.evidenceIds })) }
        : { disposition: 'abstain', reason: answer.reason ?? 'No supported answer.', claims: [] };
    const expected = loaded.fixture.claims.filter(claim => claim.question === q.key);
    const measured = scoreAnswer({ key: q.key, kind: q.kind === 'answerable' ? 'answerable' : 'unanswerable', text: q.text, reference: expected.length ? expected.map(claim => claim.reference).join(' ') : null, claims: q.claims }, expected, projected, corpus, actualTrace, loaded.fixture.cutoff);
    const support = (lane: 'local' | 'web') => [...new Set(expected.flatMap(claim => loaded.fixture.supportByLane.find(row => row.claim === claim.key)![lane]))];
    const recall = (lane: 'local' | 'web') => { const expected = support(lane); return rate(expected.filter(id => admitted.some(candidate => corpus.chunk(candidate.id)?.elements.has(id))).length, expected.length); };
    const decision = answer.disposition === 'refuse' ? 'refuse' as const : answer.disposition === 'abstain' ? 'caveat' as const
        : answer.citations.some(citation => admitted.find(row => row.id === citation.evidenceId)?.lane === 'web') ? 'prefer-web' as const : 'prefer-local' as const;
    const scored: PrihaCase = { question: q.key, expected: q.kind === 'answerable' ? 'answer' : q.kind, given: answer.disposition as 'answer' | 'abstain' | 'refuse',
        correctDisposition: answer.disposition === (q.kind === 'answerable' ? 'answer' : q.kind), trace: actualTrace, claims: measured.claims, citations: measured.citations,
        decision, decisionCorrect: decision === q.decision, localRecall: recall('local'), webRecall: recall('web') };
    return { scored, actualTrace };
}

export async function measurePrihaAnswers(loaded: LoadedPrihaFixture) {
    const registration = loaded.answerExecution, checked = await loadGroundingProfile(JSON.parse(new TextDecoder().decode(loaded.bodies.get(registration.profile.file)!)));
    if (!checked.valid || checked.value.revision !== registration.profile.revision) throw Error('The registered fictional answer profile does not validate.');
    const profile = checked.value, directory = await mkdtemp(join(tmpdir(), 'priha-answer-'));
    const records = await prihaWebReplayRecords(loaded.fixture.web, loaded.webExecution, loaded.bodies);
    const controlRecords: WebReplayRecord[] = registration.webControls.records.map(record => ({ ...record, headers: record.headers.map(row => [row[0]!, row[1]!] as [string, string]), bytes: loaded.bodies.get(record.file)! }));
    const runs: PrihaAnswerRun[] = [], safety: PrihaAnswerSafety[] = [], observations: PrihaConflictObservation[] = [];
    let controlCalls = 0;
    const treatments: Array<Partial<PrihaRow> & { key: PrihaRow['key'] }> = [];
    try {
        for (const treatment of registration.rows) {
            const path = join(directory, treatment.key + '.sqlite');
            const host = await createPrihaCorpus(loaded, profile, loaded.fixture.granularities.find(row => row.id === treatment.granularity)!, path);
            const cases: PrihaCase[] = [], rowRuns: PrihaAnswerRun[] = [];
            let rowClosed = false;
            try {
                for (const script of registration.cases.filter(row => row.row === treatment.key)) {
                    const q = loaded.fixture.questions.find(row => row.key === script.question)!;
                    const result = await executeCase(host, treatment, script, q.key);
                    cases.push(result.scored); rowRuns.push(result.run); runs.push(result.run);
                }
                for (const control of registration.safety) {
                    const script = registration.cases.find(row => row.row === treatment.key && row.question === control.question)!;
                    const result = await executeCase(host, treatment, script, 'safety-' + control.id, control);
                    const answer = result.answer;
                    safety.push({ row: treatment.key, id: control.id, disposition: answer.disposition as 'answer' | 'abstain' | 'refuse', code: answer.validation.issues[0]?.code ?? null,
                        calls: result.run.calls, repairs: answer.validation.repairs, visibleClaims: answer.claims.length,
                        passed: answer.disposition === control.expected && answer.validation.issues.some(issue => issue.code === 'TGRD1008') && answer.claims.length === 0 && answer.validation.repairs === 1 });
                }
                if (treatment.key === 'local-hybrid') { const controls = await conflictControls(host); observations.push(...controls.observations); controlCalls += controls.calls; }
                await host.close(); rowClosed = true;
                const reopened = await openTangleDb({ path });
                try {
                    const store = createGroundingStore(reopened);
                    for (const run of rowRuns) {
                        const trace = await store.readTrace(run.sessionId), held = trace?.answers.find(answer => answer.id === run.answerId);
                        if (!held || !equalsJson(trace!.unused.slice().sort(), run.unused.slice().sort()) || !trace!.session.answerIds.includes(held.id)) throw Error('Reopened answer trace drift.');
                        run.reopened = true;
                    }
                } finally { await reopened.close(); }
                const calls = rowRuns.reduce((sum, run) => sum + run.calls, 0), tokens = rowRuns.reduce((sum, run) => sum + run.tokens, 0);
                treatments.push({ key: treatment.key, status: 'scripted', reason: 'Registered scripts execute actual retrieval and validated claim generation; live quality is unmeasured.',
                    answer: { status: 'executed', reason: null, cases: cases.length }, retrieval: { status: 'executed', reason: null, cases: cases.length },
                    web: { searches: rowRuns.reduce((sum, row) => sum + row.searches, 0), results: rowRuns.reduce((sum, row) => sum + row.snippets, 0),
                        snippets: rowRuns.reduce((sum, row) => sum + row.snippets, 0), admitted: rowRuns.reduce((sum, row) => sum + row.webAdmitted, 0),
                        denied: rowRuns.reduce((sum, row) => sum + row.webDenied, 0), redirectsOutOfPolicy: rowRuns.reduce((sum, row) => sum + row.redirectDenied, 0),
                        fetched: rowRuns.reduce((sum, row) => sum + row.fetches, 0), failed: rowRuns.reduce((sum, row) => sum + row.webFailed, 0), bytes: rowRuns.reduce((sum, row) => sum + row.bytes, 0), stopReason: 'per-case' },
                    cases, metrics: metrics(cases), counts: { planned: cases.length, answered: cases.filter(row => row.given === 'answer').length, abstained: cases.filter(row => row.given === 'abstain').length,
                        refused: cases.filter(row => row.given === 'refuse').length, failed: 0, notRun: 0 }, cost: { ...emptyTally(), turns: calls, tokens },
                    safety: { 'emergency-routed': cases.filter(row => row.question === 'refuse-1' && row.given === 'refuse').length,
                        'out-of-scope-refused': cases.filter(row => ['refuse-2','refuse-3'].includes(row.question) && row.given === 'refuse').length,
                        'fabricated-url': Number(safety.find(row => row.row === treatment.key && row.id === 'fabricated-url')?.passed),
                        'unsupported-critical': Number(safety.find(row => row.row === treatment.key && row.id === 'unsupported-critical')?.passed), 'safelist-bypass': 0 } });
            } finally { if (!rowClosed) await host.close(); }
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
    const report: PrihaAnswerReport = { status: 'executed', tier: 'scripted', executionId: await canonicalSha256(registration), profileRevision: profile.revision,
        catalogRevision: groundingArtifacts.revision, runs, safety, conflicts: observations, failed: safety.filter(row => !row.passed).length + observations.filter(row => !row.passed).length + runs.filter(row => row.leakage || !row.reopened).length,
        controlCalls, controlTokens: 10 * controlCalls, scriptedRequests: controlCalls + runs.reduce((sum, run) => sum + run.calls, 0) + safety.reduce((sum, row) => sum + row.calls, 0), providerRequests: 0, networkRequests: 0,
        leakage: runs.reduce((sum, row) => sum + row.leakage, 0), latency: 'not-measured', limitations: registration.limitations };
    return { report, treatments };

    async function executeCase(host: Host, treatment: Treatment, script: PrihaAnswerScript, suffix: string, control?: PrihaAnswerExecution['safety'][number]) {
        let session = contractMust(await host.grounding.createSession({ conversationId: treatment.key + ':' + suffix, profileId: profile.id, profileRevision: profile.revision }));
        let candidates: EvidenceCandidate[] = [], admitted: EvidenceCandidate[] = [], conflicts: EvidenceConflict[] = [], webPosition = 0, calls = 0;
        const q = loaded.fixture.questions.find(row => row.key === script.question)!, rules = evaluateProfileRules(profile, { text: q.text });
        const webScript = script.webCase ? loaded.webExecution.cases.find(row => row.id === script.webCase)!.script : [];
        const account = createBudgetAccount({ turns: profile.budgets.calls, tokens: profile.budgets.tokens, ms: profile.budgets.ms }, () => 0);
        const client: MasChatClient = createSharedBudgetClient({ endpoint: { provider: 'scripted' }, async complete(request) {
            calls++; const stage = stageOf(request, registration); let reply: unknown;
            if (stage === 'triage') reply = { triage: 'simple', reason: 'Registered atomic administrative question.', requiredFields: [], intents: ['administrative-information'] };
            else if (stage === 'plan') reply = { queries: [{ text: script.planQuery, why: 'Registered atomic question.', lanes: { local: treatment.local, web: treatment.web } }] };
            else if (stage === 'web-agent' || stage === 'web-sufficiency') {
                const step = webScript[webPosition++];
                if (!step || step.stage !== stage) throw Error('Unregistered answer web step.');
                return { message: structuredClone(step.reply), usage: { total_tokens: 10 } };
            } else if (stage === 'reconcile') reply = { decisions: conflicts.filter(row => row.decision === 'unresolved').map(row => ({ conflictId: row.id, interpretation: script.reconciliation.interpretation,
                decision: row.severity === 'critical' ? script.reconciliation.critical : script.reconciliation.nonCritical })) };
            else if (stage === 'generate') reply = control ? { disposition: 'answer', claims: [{ id: 'bad-claim', text: 'This unsupported assertion must never be shown.', critical: true,
                citations: control.id === 'fabricated-url' ? ['https://invented.example/answer'] : [], caveats: [] }] } : bindRecipe(script, admitted, host, loaded);
            else if (stage === 'repair') reply = control?.repair ?? [];
            else throw Error('Unsupported scripted answer stage.');
            return { message: { content: JSON.stringify(reply) }, usage: { total_tokens: 10 } };
        } }, account);
        let plan: QueryPlan;
        if (treatment.optimizer && !rules.emergency && !rules.outOfScope) {
            const optimizer = createQueryOptimizer({ profile, store: host.grounding, clients: { triage: { client, identity: null }, plan: { client, identity: null } }, clock: () => 0, factVocabulary: loaded.userFacts });
            const triaged = await optimizer.triage(session, q.text); if (!triaged.ok) throw Error(JSON.stringify(triaged.issue));
            const planned = await optimizer.plan(triaged.value.session); if (!planned.ok || !planned.value.plan) throw Error('The registered simple plan did not complete.');
            session = planned.value.session; plan = planned.value.plan;
        } else ({ session, plan } = await manualPlan(host, profile, session, q.text, { local: treatment.local, web: treatment.web }));
        session = contractMust(await host.grounding.transitionSession(session.id, { kind: 'retrieve' }, session.revision));
        if (!rules.emergency && !rules.outOfScope) for (const query of plan.queries) {
            if (query.lanes.local) candidates.push(...await localCandidates(host, profile, session, query, treatment.key === 'flat-semantic', loaded.fixture.cutoff));
            if (query.lanes.web) {
                const transport = await createReplayWebTransport(records, { searxBase: loaded.webExecution.searxBase });
                const lane = createWebLane({ profile, store: host.grounding, client, modelIdentity: null, transport, clock: () => 0, now: () => loaded.fixture.cutoff });
                const result = await lane.retrieve(session, query.id); if (!result.ok) throw Error(JSON.stringify(result.issue)); candidates.push(...result.candidates);
            }
        }
        contractMust(await host.grounding.putEvidence(candidates));
        session = contractMust(await host.grounding.transitionSession(session.id, { kind: 'reconcile' }, session.revision));
        const reconciled = await reconcileEvidence(profile, candidates, { sessionId: session.id, now: loaded.fixture.cutoff, facts: await reconciliationFacts(candidates, host, loaded), criticalQueries: q.critical ? plan.queries.map(row => row.id) : [] });
        admitted = [...reconciled.admitted]; conflicts = reconciled.conflicts;
        if (treatment.ordering === 'legacy-weight-hypothesis') {
            const hypothesis = loaded.fixture.hypothesis;
            const score = (row: EvidenceCandidate) => (row.lane === 'local' ? hypothesis.localWeight : 1 - hypothesis.localWeight)
                * (row.authority.tier === 'official' ? hypothesis.authorityBoost : 1)
                - (row.times.provenance && row.times.effectiveAt ? Math.max(0, (Date.parse(loaded.fixture.cutoff) - Date.parse(row.times.effectiveAt)) / 86400000) * hypothesis.stalenessPenalty : 0);
            admitted.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
            let chars = 0;
            admitted = admitted.filter(row => { const size = row.excerpt.length; if (chars + size > hypothesis.maxContextChars) return false; chars += size; return true; });
        }
        session = contractMust(await host.grounding.transitionSession(session.id, { kind: 'answer' }, session.revision));
        const result = await generateGroundedClaims({ profile, client, modelIdentity: null, sessionId: session.id, query: q.text, plan, admitted, conflicts,
            store: host.grounding, corpus: host.store, expectedRevision: session.revision, clock: () => 0, critical: q.critical });
        if (!result.ok) throw Error(JSON.stringify(result.issue));
        if (!control && result.answer.validation.issues.length) throw Error('Unexpected registered answer failure: ' + JSON.stringify(result.answer.validation.issues));
        const answer = result.answer, trace = (await host.grounding.readTrace(session.id))!;
        const { scored } = scoreRuntimeAnswer(host, loaded, q, answer, candidates, admitted);
        const cited = answer.citations.map(row => row.evidenceId), leakage = cited.filter(id => trace.unused.includes(id) || !answer.claims.some(claim => claim.evidenceIds.includes(id))).length;
        const webSpend = trace.webRuns.reduce((sum, row) => ({ searches: sum.searches + row.spend.searches, fetches: sum.fetches + row.spend.fetches, bytes: sum.bytes + row.spend.bytes }), { searches: 0, fetches: 0, bytes: 0 });
        const webCounts = trace.webRuns.flatMap(run => run.attempts).reduce((sum, attempt) => ({ webDenied: sum.webDenied + attempt.denied.length,
            webFailed: sum.webFailed + attempt.failed.length, webAdmitted: sum.webAdmitted + attempt.admitted.length, snippets: sum.snippets + attempt.snippets,
            redirectDenied: sum.redirectDenied + attempt.denied.filter(row => (row.hop ?? 0) > 0).length }), { webDenied: 0, webFailed: 0, webAdmitted: 0, snippets: 0, redirectDenied: 0 });
        const run: PrihaAnswerRun = { row: treatment.key, question: q.key, sessionId: session.id, answerId: answer.id, queries: plan.queries.map(row => row.text),
            retrieved: candidates.map(row => row.id), admitted: admitted.map(row => row.id), unused: trace.unused, cited, claimTexts: answer.claims.map(row => row.text),
            conflictIds: result.conflicts.map(row => row.id), ineligible: reconciled.ineligible, calls, tokens: account.spent().tokens, repairs: answer.validation.repairs,
            ...webSpend, ...webCounts, stopReason: answer.stopReason, leakage, reopened: false };
        return { scored, run, answer };
    }

    async function conflictControls(host: Host) {
        return runConflictControls(host, profile, loaded, [...records, ...controlRecords]);
    }
}

async function runConflictControls(host: Host, profile: GroundingProfile, loaded: LoadedPrihaFixture, records: WebReplayRecord[]) {
    const registration = loaded.answerExecution;
    let session = contractMust(await host.grounding.createSession({ conversationId: 'reconciliation-controls', profileId: profile.id, profileRevision: profile.revision }));
    const planned = await manualPlan(host, profile, session, 'Harbour conflict controls', { local: true, web: true }); session = planned.session;
    session = contractMust(await host.grounding.transitionSession(session.id, { kind: 'retrieve' }, session.revision));
    let position = 0, calls = 0; let unresolved: EvidenceConflict[] = [];
    const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
        calls++; const stage = stageOf(request, registration);
        if (stage === 'reconcile') return { message: { content: JSON.stringify({ decisions: unresolved.filter(row => row.decision === 'unresolved').map(row => ({ conflictId: row.id,
            decision: row.severity === 'critical' ? 'refuse' : 'caveat', interpretation: 'The registered official notices conflict.' })) }) }, usage: { total_tokens: 10 } };
        const step: PrihaWebStep | undefined = registration.webControls.script[position++];
        if (!step || step.stage !== stage) throw Error('Unregistered conflict control request.');
        return { message: structuredClone(step.reply), usage: { total_tokens: 10 } };
    } };
    const transport = await createReplayWebTransport(records, { searxBase: loaded.webExecution.searxBase });
    const web = await createWebLane({ profile, client, modelIdentity: null, transport, store: host.grounding, clock: () => 0, now: () => loaded.fixture.cutoff }).retrieve(session, planned.plan.queries[0]!.id);
    if (!web.ok) throw Error(JSON.stringify(web.issue));
    const observations: PrihaConflictObservation[] = [];
    for (const control of registration.conflicts) {
        const candidates: EvidenceCandidate[] = [];
        const facts: Record<string, ReconciliationFact> = {};
        for (const key of [control.left, control.right].filter((value): value is string => value !== null)) {
            let candidate: EvidenceCandidate;
            if (key.startsWith('web-')) {
                const found = web.candidates.find(row => versionOf(row, host, loaded) === key); if (!found) throw Error('Missing registered control web page.'); candidate = found;
            } else {
                const versionId = [...host.versionKeys].find(([, value]) => value === key)![0], chunk = host.allChunks.find(row => row.versionId === versionId)!;
                const source = (await host.store.getSource(chunk.sourceId))!, manifest = (await host.grounding.getManifest(chunk.sourceId, versionId))!;
                const parent = host.allParents.find(row => row.id === chunk.parentChunkId);
                // Superseded controls retain their historical descriptor; they are never admitted to generation.
                candidate = { id: await groundingIdOf('evidence', { sessionId: session.id, control: key }), sessionId: session.id, profileRevision: profile.revision,
                    queryId: planned.plan.queries[0]!.id, lane: 'local', address: { sourceId: source.id, versionId, chunkId: chunk.id, ...(parent ? { parentChunkId: parent.id } : {}) },
                    excerpt: parent?.text ?? chunk.text, scores: {}, rankerId: 'registered-control/1', authority: { tier: manifest.authorityTier, institution: manifest.institution, ruleIds: ['curator:' + manifest.id] },
                    times: manifest.times, admitted: { by: ['registered-control'], at: loaded.fixture.cutoff }, citation: { url: manifest.canonicalUrl, title: source.title ?? source.canonicalUrl, headingPath: chunk.headingPath } };
                facts[candidate.id] = { jurisdiction: control.id === 'jurisdiction-mismatch' ? 'Hong Kong' : manifest.jurisdiction, versionStatus: (await host.store.getVersion(versionId))!.status };
            }
            candidates.push(candidate);
        }
        const result = await reconcileEvidence(profile, candidates, { sessionId: session.id, now: loaded.fixture.cutoff, facts,
            criticalQueries: control.critical ? [planned.plan.queries[0]!.id] : [] });
        contractMust(await host.grounding.putEvidence(candidates)); unresolved = result.conflicts;
        const interpreted = await interpretEvidenceConflicts({ model: await createAnswerModel({ profile, client, modelIdentity: null, clock: () => 0 }),
            query: 'Harbour conflict controls', admitted: result.admitted, conflicts: result.conflicts, store: host.grounding });
        const actual = result.ineligible[0]?.reason ?? interpreted.conflicts[0]?.decision ?? 'none';
        observations.push({ id: control.id, issue: control.issue, expected: control.expected, actual, ruleIds: [...new Set(result.conflicts.flatMap(row => row.ruleIds))], passed: actual === control.expected });
    }
    return { observations, calls };
}
