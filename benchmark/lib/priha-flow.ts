/** Execute registered treatments through one native MAS graph and SQLite worker. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { estimateTokens } from '@tangleai/core/tokens';
import { createGroundingHost, createReplayWebTransport, loadGroundingProfile, groundingArtifacts,
    type EvidenceCandidate, type GroundingHost, type GroundingHostOptions, type GroundedAnswer, type LocalRetrievalOutcome } from '@tangleai/grounding';
import { MasInfrastructureCrash, type MasRuntimeObserver } from '@tangleai/mas';
import { createGroundingSegmentHost, createGroundingStore, createDocumentStore, openTangleDb } from '@tangleai/store';
import { createPrihaCorpus } from './priha-local.ts';
import { prihaWebReplayRecords } from './priha-replay.ts';
import { stageOf, bindRecipe, reconciliationFacts, metrics, localCandidates, scoreRuntimeAnswer, measurePrihaAnswers } from './priha-answer.ts';
import { contractMust } from './priha-contracts.ts';
import type { LoadedPrihaFixture, PrihaCase } from './priha.ts';
import type { PrihaAnswerScript, PrihaAnswerExecution, PrihaFlowReport, PrihaFlowRun, PrihaFlowPath, PrihaFlowCrash } from './priha.types.ts';

type Corpus = Awaited<ReturnType<typeof createPrihaCorpus>>;
type Treatment = PrihaAnswerExecution['rows'][number];
const observation = ({ question, given, claims, correctDisposition, decision, decisionCorrect, localRecall, webRecall }: PrihaCase) =>
    ({ question, given, claims, correctDisposition, decision, decisionCorrect, localRecall, webRecall });
export async function measurePrihaFlow(loaded: LoadedPrihaFixture, components: Awaited<ReturnType<typeof measurePrihaAnswers>>) {
    const registration = loaded.flowExecution, answer = loaded.answerExecution;
    const checked = await loadGroundingProfile(JSON.parse(new TextDecoder().decode(loaded.bodies.get(answer.profile.file)!)));
    if (!checked.valid) throw Error('The registered flow profile was refused.');
    const profile = checked.value, directory = await mkdtemp(join(tmpdir(), 'priha-flow-'));
    const records = await prihaWebReplayRecords(loaded.fixture.web, loaded.webExecution, loaded.bodies);
    const rows: PrihaFlowReport['rows'] = [], paths: PrihaFlowPath[] = [], crashes: PrihaFlowCrash[] = [];
    const now = () => loaded.fixture.cutoff;
    let scriptedRequests = 0, baselineCalls = 0;
    async function scenario(corpus: Corpus, treatment: Treatment, script: PrihaAnswerScript, name: string, options: {
        complex?: boolean; dead?: boolean; observer?: MasRuntimeObserver; jobClock?: () => number;
    } = {}) {
        let current = corpus, calls = 0, resolveTurns = 0, webPosition = 0;
        const session = contractMust(await current.grounding.createSession({ conversationId: name, profileId: profile.id, profileRevision: profile.revision }));
        const transport = await createReplayWebTransport(records, { searxBase: loaded.webExecution.searxBase });
        const query = loaded.fixture.questions.find(row => row.key === script.question)!;
        async function inputs() {
            const retained = (await current.grounding.readTrace(session.id))!;
            const native = await segments().store.readTrace(retained.session.execution!.runId);
            const stage = native?.attempts.find(row => row.invocationId === 'reconcile' && row.status === 'completed');
            const value = stage?.output as { context?: { evidenceIds: string[]; conflictIds: string[] } } | undefined;
            return { candidates: retained.evidence.filter(row => value?.context?.evidenceIds.includes(row.id)),
                conflicts: retained.conflicts.filter(row => value?.context?.conflictIds.includes(row.id)) };
        }
        const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
            calls++; scriptedRequests++;
            if (options.dead) throw Error('Registered unavailable model wire.');
            const stage = stageOf(request, { ...answer, prompts: registration.prompts }); let reply: unknown;
            if (stage === 'triage') {
                resolveTurns = 0; webPosition = 0;
                reply = { triage: options.complex ? 'complex' : 'simple', reason: 'Registered flow path.', requiredFields: options.complex ? [registration.complexRequiredField] : [],
                    intents: [options.complex ? 'service-navigation' : 'administrative-information'] };
            } else if (stage === 'question') reply = { questions: [{ id: 'q1', text: profile.clarification.requiredFields.find(row => row.id === registration.complexRequiredField)!.question }] };
            else if (stage === 'resolve') {
                const resolved = resolveTurns++ >= 2;
                reply = { refinedQuery: script.planQuery, resolved, result: { answer: '', disposition: resolved ? 'completed' : 'needs-information', claims: [], findings: [], outstandingQuestions: resolved ? [] : [registration.complexRequiredField] } };
            } else if (stage === 'plan') reply = { queries: [{ text: script.planQuery, why: 'Registered atomic question.', lanes: { local: treatment.local, web: treatment.web } }] };
            else if (stage === 'web-agent' || stage === 'web-sufficiency') {
                const steps = script.webCase ? loaded.webExecution.cases.find(row => row.id === script.webCase)!.script : [];
                const step = steps[webPosition++];
                if (!step || step.stage !== stage) throw Error('Unregistered flow web request: ' + stage);
                return { message: structuredClone(step.reply), usage: { total_tokens: 10 } };
            } else if (stage === 'reconcile') {
                const { conflicts } = await inputs();
                reply = { decisions: conflicts.filter(row => row.decision === 'unresolved').map(row => ({ conflictId: row.id, interpretation: script.reconciliation.interpretation,
                    decision: row.severity === 'critical' ? script.reconciliation.critical : script.reconciliation.nonCritical })) };
            } else if (stage === 'generate') reply = bindRecipe(script, (await inputs()).candidates, current, loaded);
            else if (stage === 'repair') reply = [];
            else throw Error('Unregistered flow model stage: ' + stage);
            return { message: { role: 'assistant' as const, content: JSON.stringify(reply) }, usage: { total_tokens: 10 } };
        } };
        const segments = () => createGroundingSegmentHost(current.db, { now, jobClock: options.jobClock ?? (() => 1_000_000), deadlineFor: ms => new Date(Date.parse(now()) + ms).toISOString() });
        const policy: NonNullable<GroundingHostOptions['policy']> = { id: 'priha-flow-treatment', version: await canonicalSha256({ treatment, query: query.key, critical: query.critical,
            hypothesis: loaded.fixture.hypothesis, topics: answer.topics }), critical: query.critical, lanes: { local: treatment.local, web: treatment.web },
            facts: candidates => reconciliationFacts([...candidates], current, loaded),
            order: async candidates => {
                const ordered = [...candidates];
                if (treatment.ordering !== 'legacy-weight-hypothesis') return ordered;
                const h = loaded.fixture.hypothesis;
                const score = (row: EvidenceCandidate) => (row.lane === 'local' ? h.localWeight : 1 - h.localWeight) * (row.authority.tier === 'official' ? h.authorityBoost : 1)
                    - (row.times.provenance && row.times.effectiveAt ? Math.max(0, (Date.parse(now()) - Date.parse(row.times.effectiveAt)) / 86400000) * h.stalenessPenalty : 0);
                ordered.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)); let chars = 0;
                return ordered.filter(row => { if (chars + row.excerpt.length > h.maxContextChars) return false; chars += row.excerpt.length; return true; });
            },
        };
        if (treatment.key === 'flat-semantic') policy.local = async (session, query, selection): Promise<LocalRetrievalOutcome> => {
            const candidates = await localCandidates(current, profile, session, query, true, now());
            const contextTokens = candidates.reduce((n, row) => n + estimateTokens(row.excerpt), 0);
            if (contextTokens > selection.contextTokens) throw Error('Frozen flat control exceeds the shared context budget.');
            return { ok: true, candidates, parents: [], reason: candidates.length ? 'selected' : 'no-evidence', census: {
                activeVersions: current.active.size, children: current.allChunks.filter(row => current.active.has(row.versionId)).length,
                semantic: candidates.length, lexical: 0, skipped: 0, deduplicated: 0, diversityDropped: 0, parentsOverBudget: 0, selected: candidates.length,
                issues: 0, rebuilds: 0, rebuildMs: 0, generation: 0, sourceRevision: loaded.fixtureId, contextTokens } };
        };
        const compose = () => createGroundingHost({ profile, store: current.grounding, corpus: current.store, embedder: current.embedder,
            segments: segments(), transport, clientFor: () => ({ client, identity: null }), now, clock: () => 0, factVocabulary: loaded.userFacts,
            policy, ...(options.observer ? { observer: options.observer } : {}) });
        let host = await compose();
        return { sessionId: session.id, get host() { return host; }, get corpus() { return current; }, query,
            stats: () => ({ calls, requests: transport.stats().requests }),
            start: (text = query.text) => host.start({ text, conversationId: name, mode: treatment.optimizer ? 'optimized' : 'raw' }),
            async reopen(path: string) {
                await current.close(); const db = await openTangleDb({ path, jobs: { now: options.jobClock ?? (() => 1_000_000), random: () => 0.5 } });
                current = { ...current, db, grounding: createGroundingStore(db), store: createDocumentStore(db), close: () => db.close() }; host = await compose();
            },
            close: () => current.close(),
        };
    }
    try {
        for (const treatment of answer.rows) {
            const path = join(directory, treatment.key + '.sqlite');
            const corpus = await createPrihaCorpus(loaded, profile, loaded.fixture.granularities.find(row => row.id === treatment.granularity)!, path);
            const cases: PrihaCase[] = [], runs: PrihaFlowRun[] = [];
            try {
                for (const script of answer.cases.filter(row => row.row === treatment.key)) {
                    const s = await scenario(corpus, treatment, script, 'flow:' + treatment.key + ':' + script.question);
                    const reply = await s.start(), trace = (await corpus.grounding.readTrace(s.sessionId))!;
                    const held = trace.answers.find(row => row.id === trace.session.answerIds.at(-1));
                    const native = await createGroundingSegmentHost(corpus.db, { now, jobClock: () => 1_000_000, deadlineFor: () => now() }).store.readTrace(reply.identities.runId);
                    const result = native?.attempts.find(row => row.invocationId === 'reconcile' && row.status === 'completed')?.output as { context?: { evidenceIds: string[] } } | undefined;
                    const admitted = trace.evidence.filter(row => result?.context?.evidenceIds.includes(row.id));
                    const answerValue: Pick<GroundedAnswer, 'disposition' | 'claims' | 'citations' | 'reason'> = held ?? {
                        disposition: 'refuse', claims: [], citations: [], reason: reply.answer?.text ?? reply.failure?.detail ?? 'No completed answer.' };
                    cases.push(scoreRuntimeAnswer(corpus, loaded, s.query, answerValue, trace.evidence, admitted).scored);
                    runs.push({ question: script.question, sessionId: s.sessionId, runId: reply.identities.runId, workflowVersionId: reply.identities.workflowVersionId,
                        answerId: held?.id ?? null, intentId: trace.session.intentId ?? null, planId: trace.session.planId ?? null,
                        disposition: reply.disposition, calls: s.stats().calls, tokens: reply.trace.tokens, requests: s.stats().requests, reopened: false,
                        failure: reply.failure?.detail ?? null });
                    if (reply.trace.calls !== s.stats().calls) throw Error('Native and physical flow call counts disagree.');
                }
            } finally { await corpus.close(); }
            const reopened = await openTangleDb({ path });
            try { const store = createGroundingStore(reopened); for (const run of runs) {
                const trace = await store.readTrace(run.sessionId); run.reopened = Boolean(trace?.session.execution?.runId === run.runId && (run.answerId === null || trace.answers.some(row => row.id === run.answerId)));
            } } finally { await reopened.close(); }
            const measured = metrics(cases), component = components.treatments.find(row => row.key === treatment.key)!;
            const frozen = registration.baseline.rows.find(row => row.key === treatment.key)!;
            const calls = runs.reduce((n, row) => n + row.calls, 0), tokens = runs.reduce((n, row) => n + row.tokens, 0);
            const componentParity = equalsJson(measured, component.metrics) && equalsJson(cases.map(observation), component.cases!.map(observation))
                && calls === (component.cost as { turns: number }).turns && tokens === (component.cost as { tokens: number }).tokens;
            const frozenQualityParity = equalsJson(measured, frozen.metrics) && equalsJson(cases.map(observation), frozen.cases);
            const frozenCallsParity = calls === (frozen.cost as { turns: number }).turns, oldTokens = (frozen.cost as { tokens: number }).tokens;
            rows.push({ key: treatment.key, cases, metrics: measured, runs, calls, tokens, requests: runs.reduce((n, row) => n + row.requests, 0), componentParity,
                frozenQualityParity, frozenCallsParity, oldTokens, tokenCorrection: tokens - oldTokens,
                passed: componentParity && frozenQualityParity && frozenCallsParity && runs.every(row => row.reopened && row.failure === null) });
        }
        const question = registration.pathQuestion;
        const original = answer.rows.find(row => row.key === 'priha-full')!;
        const local = { ...original, web: false, ordering: 'ranked' as const };
        const script = answer.cases.find(row => row.row === 'priha-full' && row.question === question)!;
        const simple = async (name: string, options: NonNullable<Parameters<typeof scenario>[4]> = {}, treatment: Treatment = local) => {
            const path = join(directory, name + '.sqlite'), corpus = await createPrihaCorpus(loaded, profile, loaded.fixture.granularities.find(row => row.id === treatment.granularity)!, path, options.jobClock);
            return { s: await scenario(corpus, treatment, script, 'flow:path:' + (options.complex ? 'complex' : 'simple'), options), path };
        };
        async function finish(s: Awaited<ReturnType<typeof scenario>>, resume = false) {
            let reply = resume ? await s.host.enqueue(s.sessionId) : await s.start(); const dispositions = [reply.disposition];
            if (reply.disposition === 'clarification') { reply = await s.host.respond(s.sessionId, reply.question!.interactionId, { answers: { q1: registration.complexAnswer } }); dispositions.push(reply.disposition); }
            const trace = (await s.corpus.grounding.readTrace(s.sessionId))!;
            return { reply, dispositions, ids: [s.sessionId, trace.session.intentId ?? null, trace.session.planId ?? null, ...trace.session.answerIds], stats: s.stats() };
        }
        for (const id of registration.paths) {
            let epoch = 1_000_000, armed = id === 'retry';
            const { s, path } = await simple('path-' + id, { complex: id === 'complex', dead: id === 'failure', jobClock: () => epoch,
                observer: { onNodeSettle(path, status) { if (armed && path === 'generate' && status === 'completed') { armed = false; throw new MasInfrastructureCrash('Registered retry path'); } } } });
            try {
                let result: Awaited<ReturnType<typeof finish>>, reopens = 0, identical = true, duplicateCalls = 0, duplicateRequests = 0;
                if (id === 'refusal') {
                    const reply = await s.start('fictional emergency test phrase');
                    result = { reply, dispositions: [reply.disposition], ids: [s.sessionId], stats: s.stats() };
                } else if (id === 'complex') {
                    const waiting = await s.start(), before = s.stats(); await s.reopen(path); reopens++;
                    const restored = await s.host.get(s.sessionId); identical = equalsJson(restored, waiting) && equalsJson(s.stats(), before);
                    result = await finish(s, true);
                } else if (id === 'retry') {
                    try { await finish(s); throw Error('The registered crash did not occur.'); } catch (cause) { if (!(cause instanceof MasInfrastructureCrash)) throw cause; }
                    const before = s.stats(); epoch += 1000; await s.reopen(path); reopens++; result = await finish(s, true);
                    duplicateCalls = result.stats.calls - before.calls; duplicateRequests = result.stats.requests - before.requests;
                } else result = await finish(s);
                if (id === 'refresh') { const old = result.reply, reply = await s.host.refresh(s.sessionId, 'Registered refreshed execution');
                    identical = reply.identities.runId !== old.identities.runId && (await s.corpus.grounding.getSession(s.sessionId))!.execution!.previousRunId === old.identities.runId;
                    result.reply = reply; result.dispositions.push(reply.disposition); result.stats = s.stats(); }
                const expected = id === 'failure' ? 'failure' : id === 'refusal' ? 'refusal' : 'answer';
                paths.push({ id, dispositions: result.dispositions, calls: result.stats.calls, requests: result.stats.requests, reopens, identical, duplicateCalls, duplicateRequests,
                    passed: result.reply.disposition === expected && identical && duplicateCalls === 0 && duplicateRequests === 0 && (id !== 'refusal' || result.stats.calls === 0) });
            } finally { await s.close(); }
        }
        for (const complex of [false, true]) {
            const completed: string[] = [], mode = complex ? 'complex' : 'web', treatment = complex ? local : original;
            const baseline = await simple('baseline-' + mode, { complex, observer: { onNodeSettle(path, status) { if (status === 'completed') completed.push(path); } } }, treatment);
            let expected: Awaited<ReturnType<typeof finish>>;
            try { expected = await finish(baseline.s); baselineCalls += expected.stats.calls; } finally { await baseline.s.close(); }
            for (const [index, crashPath] of [...new Set(completed)].entries()) {
                let epoch = 1_000_000, armed = true, replayed = 0, restored = 0;
                const { s, path } = await simple(mode + '-crash-' + index, { complex, jobClock: () => epoch, observer: {
                    onNodeSettle(path, status) { if (armed && path === crashPath && status === 'completed') { armed = false; throw new MasInfrastructureCrash(crashPath); } },
                    onNodeReplay() { replayed++; }, onNodeRestored() { restored++; }, onRegionRestored(paths) { restored += paths.length; },
                } }, treatment);
                try {
                    try { await finish(s); throw Error('The registered stage was not terminated.'); } catch (cause) { if (!(cause instanceof MasInfrastructureCrash)) throw cause; }
                    epoch += 1000; await s.reopen(path); const result = await finish(s, true);
                    const identical = equalsJson(result.ids, expected!.ids) && result.reply.disposition === expected!.reply.disposition;
                    const duplicateCalls = Math.max(0, result.stats.calls - expected!.stats.calls), duplicateRequests = Math.max(0, result.stats.requests - expected!.stats.requests);
                    crashes.push({ path: mode + ':' + crashPath, ...result.stats, identical, duplicateCalls, duplicateRequests, replayed, restored,
                        passed: identical && equalsJson(result.stats, expected!.stats) && replayed + restored > 0 });
                } finally { await s.close(); }
            }
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
    const report: PrihaFlowReport = { status: 'executed', tier: 'scripted', executionId: await canonicalSha256(registration), baselineReportId: registration.baseline.reportId,
        rows, paths, crashes, failed: [...rows, ...paths, ...crashes].filter(row => !row.passed).length, scriptedRequests, baselineCalls, providerRequests: 0, networkRequests: 0,
        correction: 'The earlier component script classified stages using any message, including quoted user content. Matching the system message fixes 29 assessment requests per web-enabled row. Claim scores and physical call counts are unchanged; each corrected row records 290 more tokens. The earlier receipt is frozen in the flow registration.',
        limitations: registration.limitations };
    return report;
}
