/** Exact-authorized provider requests run the public workflow against the frozen fictional corpus. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { lookup as dnsLookup } from 'node:dns/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { WebTransport } from '@tangleai/grounding';
import { createGroundingStore, openTangleDb } from '@tangleai/store';
import { chatClientFor } from '../../apps/desktop/src/settings.ts';
import { chatSettingsOf, envConfigIdentity } from './ai-env.ts';
import { openHttpCapture } from './http-capture.ts';
import { createPrihaCorpus } from './priha-local.ts';
import { createPrihaFlowScenarios, observePrihaFlowScenario } from './priha-flow.ts';
import { comparePrihaCases } from './priha-ablation.ts';
import { metrics } from './priha-answer.ts';
import type { LoadedPrihaFixture, PrihaCase } from './priha.ts';
import type { runPrihaLive } from './priha-live.ts';
import type { PrihaLiveExecution, PrihaLivePlan } from './priha.types.ts';

export async function executePrihaLive(plan: PrihaLivePlan['plan'], loaded: LoadedPrihaFixture,
    options: Parameters<typeof runPrihaLive>[2]): Promise<PrihaLiveExecution> {
    const date = options.now ?? (() => new Date()), at = date().toISOString(), identity = await envConfigIdentity(options.env, null);
    const directory = options.databaseDirectory ?? join(options.root ?? process.cwd(), 'benchmark/cache', 'priha-live-' + plan.planId + '-' + at.replace(/[:.]/g, '-'));
    await mkdir(join(directory, '..'), { recursive: true });
    await mkdir(directory); // An existing execution directory is never silently reused or repurchased.
    let providerRequests = 0, webRequests = 0, webBytes = 0, logicalCalls = 0, currentCalls = 0, currentWebBytes = 0, currentWebRequests = 0;
    const wire = chatClientFor({ ...chatSettingsOf(options.env), maxTokens: plan.limits.maxOutputTokens }, {
        retry: { attempts: plan.limits.retryAttempts }, reasoning: { enabled: false }, fetch: async (input, init) => {
            if (providerRequests >= plan.maxFreshCalls || providerRequests >= options.env.maxCalls || currentCalls >= plan.budget.modelCalls)
                throw Error('The frozen PriHA provider request ceiling is exhausted.');
            providerRequests++; currentCalls++; return (options.fetch ?? globalThis.fetch)(input, init);
        } });
    const client = { endpoint: wire.endpoint, async complete(value: Parameters<typeof wire.complete>[0]) {
        logicalCalls++; return wire.complete({ ...value, maxTokens: plan.limits.maxOutputTokens, reasoning: { enabled: false }, stream: false });
    } };
    const capture = plan.transport.mode === 'live-capture' ? await openHttpCapture({ path: join(directory, 'http.sqlite'), clock: date }) : null;
    const transport: WebTransport | undefined = capture ? {
        searxBase: plan.transport.searxBase, revision: await canonicalSha256(plan.transport),
        lookup: options.lookup ?? (async host => dnsLookup(host, { all: true })),
        fetch: async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input)), searx = new URL(plan.transport.searxBase);
            const kind = url.origin === searx.origin && url.pathname === searx.pathname.replace(/\/+$/, '') + '/search' ? 'searxng' : 'document';
            if (webRequests >= plan.maxWebHttpRequests || currentWebBytes >= plan.budget.maxBytes || webBytes >= plan.maxWebBytes
                || currentWebRequests >= plan.budget.searches + plan.budget.fetches * (plan.transport.maxRedirects + 1) * 2)
                throw Error('The frozen PriHA web transport ceiling is exhausted.');
            const fetch = capture.fetchFor(kind, { replay: false, maxResponseBytes: Math.min(plan.budget.maxBytes - currentWebBytes, plan.maxWebBytes - webBytes),
                onBytesRead(bytes) { currentWebBytes += bytes; webBytes += bytes; },
                inner: async (request, settings) => { webRequests++; currentWebRequests++; return (options.webFetch ?? options.fetch ?? globalThis.fetch)(request, settings); } });
            return fetch(input, init);
        },
    } : undefined;
    const rows: PrihaLiveExecution['rows'] = [];
    try {
        const { profile, scenario } = await createPrihaFlowScenarios(loaded);
        for (const treatment of loaded.answerExecution.rows) {
            const path = join(directory, treatment.key + '.sqlite');
            const corpus = await createPrihaCorpus(loaded, profile, loaded.fixture.granularities.find(row => row.id === treatment.granularity)!, path);
            const cases: PrihaCase[] = [], runs: PrihaLiveExecution['rows'][number]['runs'] = [], beforeProvider = providerRequests, beforeWeb = webRequests;
            try {
                for (const question of plan.questionIds) {
                    const recipe = loaded.answerExecution.cases.find(row => row.row === treatment.key && row.question === question)!;
                    currentCalls = 0; currentWebBytes = 0; currentWebRequests = 0;
                    const s = await scenario(corpus, treatment, recipe, 'live:' + plan.planId + ':' + at + ':' + treatment.key + ':' + question,
                        { live: { client, identity }, ...(transport ? { transport } : {}), clock: options.clock ?? (() => Math.floor(performance.now())) });
                    // No invented host answer resolves a live clarification. An unfinished case stays in the denominator.
                    const observed = await observePrihaFlowScenario(loaded, s, await s.start());
                    cases.push(observed.scored); runs.push(observed.run);
                }
            } finally { await corpus.close(); }
            const reopened = await openTangleDb({ path });
            try { const store = createGroundingStore(reopened); for (const run of runs) {
                const trace = await store.readTrace(run.sessionId);
                run.reopened = Boolean(trace?.session.execution?.runId === run.runId && (run.answerId === null || trace.answers.some(answer => answer.id === run.answerId)));
            } } finally { await reopened.close(); }
            rows.push({ key: treatment.key, cases, runs, metrics: metrics(cases), calls: runs.reduce((sum, run) => sum + run.calls, 0),
                tokens: runs.reduce((sum, run) => sum + run.tokens, 0), providerRequests: providerRequests - beforeProvider, webRequests: webRequests - beforeWeb });
        }
        const control = rows.find(row => row.key === 'flat-semantic')!, full = rows.find(row => row.key === 'priha-full')!, raw = rows.find(row => row.key === 'drag-no-optimizer')!;
        const comparisons = [...rows.filter(row => row !== control).map(row => comparePrihaCases(row as { key: string; cases: PrihaCase[] }, control as { key: string; cases: PrihaCase[] }, loaded.completeExecution.statistics)),
            comparePrihaCases(full as { key: string; cases: PrihaCase[] }, raw as { key: string; cases: PrihaCase[] }, loaded.completeExecution.statistics)];
        const body = { document: 'priha-live-execution' as const, status: 'executed' as const, at, planId: plan.planId, registrationId: plan.registrationId,
            sourceSha256: plan.sourceSha256, identity, rows, comparisons, providerRequests, webRequests, webBytes, logicalCalls,
            capture: capture ? await capture.manifest() : [], databaseDirectory: directory, defaultChanged: false as const,
            limitations: 'Live models answered a fictional authored corpus. All failed and waiting cases remain in the denominators; no clarification fact was invented. This is not healthcare readiness or reproduction of the paper dataset, judge, providers or score.' };
        return { ...body, executionId: await canonicalSha256(body) };
    } finally { await capture?.close(); }
}
