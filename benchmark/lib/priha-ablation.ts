/** Registered mechanism removals, scored through the same native flow and claim oracle. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { mean } from '@jarenjs/core/stats';
import { createGroundingStore, openTangleDb } from '@tangleai/store';
import { createPrihaCorpus } from './priha-local.ts';
import { createPrihaFlowScenarios, observePrihaFlowScenario } from './priha-flow.ts';
import { metrics } from './priha-answer.ts';
import { bootstrapInterval, powerOf, type Pair } from './locomo-policy.ts';
import type { LoadedPrihaFixture, PrihaCase } from './priha.ts';
import type { PrihaAblationReport, PrihaAblationRow, PrihaComparison, PrihaFlowReport, PrihaAnswerReport, PrihaSafetyReport, PrihaDecision } from './priha.types.ts';

export async function measurePrihaAblation(loaded: LoadedPrihaFixture): Promise<PrihaAblationReport> {
    const registration = loaded.completeExecution, directory = await mkdtemp(join(tmpdir(), 'priha-ablation-'));
    let scriptedRequests = 0;
    const { profile, scenario } = await createPrihaFlowScenarios(loaded, () => { scriptedRequests++; });
    const rows: PrihaAblationRow[] = [];
    try {
        for (const registered of registration.ablations) {
            const treatment = registered.treatment, path = join(directory, treatment.key + '.sqlite');
            const corpus = await createPrihaCorpus(loaded, profile, loaded.fixture.granularities.find(row => row.id === treatment.granularity)!, path);
            const cases: PrihaCase[] = [], runs: PrihaAblationRow['runs'] = [];
            try {
                for (const recipe of loaded.answerExecution.cases.filter(row => row.row === registered.base)) {
                    const s = await scenario(corpus, treatment, recipe, 'ablation:' + treatment.key + ':' + recipe.question);
                    const reply = await s.start(), measured = await observePrihaFlowScenario(loaded, s, reply);
                    cases.push(measured.scored); runs.push(measured.run);
                }
            } finally { await corpus.close(); }
            const reopened = await openTangleDb({ path });
            try {
                const store = createGroundingStore(reopened);
                for (const run of runs) {
                    const trace = await store.readTrace(run.sessionId);
                    run.reopened = Boolean(trace?.session.execution?.runId === run.runId && (run.answerId === null || trace.answers.some(row => row.id === run.answerId)));
                }
            } finally { await reopened.close(); }
            rows.push({ key: treatment.key, description: registered.description, treatment, cases, runs, metrics: metrics(cases),
                calls: runs.reduce((n, row) => n + row.calls, 0), tokens: runs.reduce((n, row) => n + row.tokens, 0),
                requests: runs.reduce((n, row) => n + row.requests, 0),
                passed: cases.length === registration.questionIds.length && runs.every(row => row.reopened && row.failure === null) });
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
    return { status: 'executed', executionId: await canonicalSha256(registration), rows,
        failed: rows.filter(row => !row.passed).length, scriptedRequests, providerRequests: 0, networkRequests: 0 };
}

/** Keep the eight gold-free controls visible while retaining every scored failure among the 24 claim questions. */
export function comparePrihaCases(treatment: { key: string; cases: PrihaCase[] }, control: { key: string; cases: PrihaCase[] },
    statistics: LoadedPrihaFixture['completeExecution']['statistics']): PrihaComparison {
    const other = new Map(control.cases.map(row => [row.question, row]));
    if (treatment.cases.length !== control.cases.length || new Set(treatment.cases.map(row => row.question)).size !== other.size
        || treatment.cases.some(row => !other.has(row.question))) throw Error('Paired PriHA rows must retain the same complete question set.');
    const outcomes = treatment.cases.map(row => {
        const baseline = other.get(row.question)!;
        return { question: row.question, treatmentF1: row.claims.f1, controlF1: baseline.claims.f1,
            delta: row.claims.f1 === null || baseline.claims.f1 === null ? null : row.claims.f1 - baseline.claims.f1,
            treatmentDisposition: row.given, controlDisposition: baseline.given };
    });
    const numeric = outcomes.filter(row => row.delta !== null), deltas = numeric.map(row => row.delta!);
    const pairs: Pair[] = numeric.map(row => ({ id: row.question, category: 1, treatment: row.treatmentF1!, control: row.controlF1!, delta: row.delta!, acting: false }));
    // Prompt identity is not inferred from an output difference; only the statistical fields are retained.
    const { actingSetSize: _, ...power } = powerOf(pairs, statistics.level);
    return { metric: 'supported-claim-f1', treatment: treatment.key, control: control.key, outcomes,
        pairs: deltas.length, excludedNull: outcomes.length - deltas.length, mean: mean(deltas) ?? 0,
        interval: bootstrapInterval(deltas, statistics), power,
        wins: deltas.filter(value => value > 0).length, losses: deltas.filter(value => value < 0).length, ties: deltas.filter(value => value === 0).length };
}
export function prihaPairing(loaded: LoadedPrihaFixture, flow: PrihaFlowReport, ablation: PrihaAblationReport) {
    const control = flow.rows.find(row => row.key === 'flat-semantic')!;
    const rows = [...flow.rows.filter(row => row.key !== 'flat-semantic'), ...ablation.rows];
    const comparisons = rows.map(row => comparePrihaCases(row as { key: string; cases: PrihaCase[] }, control as { key: string; cases: PrihaCase[] }, loaded.completeExecution.statistics));
    const full = flow.rows.find(row => row.key === 'priha-full')!, raw = flow.rows.find(row => row.key === 'drag-no-optimizer')!;
    comparisons.push(comparePrihaCases(full as { key: string; cases: PrihaCase[] }, raw as { key: string; cases: PrihaCase[] }, loaded.completeExecution.statistics));
    const reasons = [...flow.rows, ...ablation.rows].filter(row => !row.passed).map(row => ({ code: 'incomplete-execution', detail: row.key }));
    if (comparisons.some(row => row.pairs !== loaded.completeExecution.claimQuestions || row.excludedNull !== loaded.completeExecution.routeQuestions))
        reasons.push({ code: 'question-denominator', detail: 'The registered claim and route denominators differ.' });
    const hypothesis = ablation.rows.find(row => row.key === 'priha-hypothesis-weights')!;
    if (!equalsJson(hypothesis.metrics, full.metrics) || hypothesis.calls !== full.calls || hypothesis.tokens !== full.tokens)
        reasons.push({ code: 'equivalence-control', detail: 'The identical historical hypothesis changed its result.' });
    return { eligible: reasons.length === 0, reasons, comparisons };
}

/** The schema independently recomputes these clauses from the retained observations. */
export function decidePriha(loaded: LoadedPrihaFixture, flow: PrihaFlowReport, answers: PrihaAnswerReport, ablation: PrihaAblationReport,
    safety: PrihaSafetyReport, pairing: ReturnType<typeof prihaPairing>): PrihaDecision {
    const full = flow.rows.find(row => row.key === 'priha-full')!, comparison = pairing.comparisons.find(row => row.treatment === 'priha-full' && row.control === 'flat-semantic')!;
    const budget = loaded.fixture.budgets;
    const clauses: PrihaDecision['clauses'] = [
        { id: 'mechanisms-executed', passed: flow.failed === 0 && answers.failed === 0 && ablation.failed === 0 && pairing.eligible },
        { id: 'independent-claim-delta', passed: comparison.mean > 0 && comparison.interval.low > 0 },
        { id: 'registered-budgets', passed: full.runs.every(run => run.calls <= budget.modelCalls && run.tokens <= budget.maxTokens && run.ms <= budget.maxMs
            && run.searches <= budget.searches && run.fetches <= budget.fetches && run.bytes <= budget.maxBytes && run.contextTokens <= 1500) },
        { id: 'citation-resolution', passed: full.metrics.citationResolution === 1 },
        { id: 'unsupported-critical', passed: full.runs.every(run => run.unsupportedCritical === 0) },
        { id: 'safelist-bypass', passed: [...full.runs, ...safety.cases.map(row => row.run)].every(run => run.safelistBypass === 0) },
        { id: 'safe-routes', passed: full.runs.every(run => run.safeRoute) },
        { id: 'adversarial-suites', passed: safety.failed === 0 },
    ];
    const losses = clauses.filter(row => !row.passed).map(row => row.id);
    return { tier: 'scripted-tier', defaultChanged: false, state: losses.length ? 'keep-experimental' : 'adopt', clauses,
        reason: losses.length ? 'Failed clauses: ' + losses.join(', ') + '. Scripted evidence changes no product default; live quality and healthcare deployment remain unmeasured.'
            : 'All registered scripted clauses pass. Scripted evidence changes no product default; live quality and healthcare deployment remain unmeasured.' };
}
