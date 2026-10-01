/** A fixed dual-retrieval experiment must refuse hidden or forged denominators. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { buildPrihaReport, loadPrihaFixture, loadPrihaControl, createPrihaValidator, requirePrihaCapability, PRIHA_ROWS, PRIHA_BAD_ROWS, PRIHA_CAPABILITY_ROWS, renderPrihaDocument, renderPrihaReport, planPrihaLive, authorizePrihaLive, runPrihaLive, prihaCorpus, prihaScoreAnswer, scorePrihaConversation, validatePrihaReport, reportIdOf, registrationIdOf, type PrihaAnswer, type PrihaFixture, } from '../../benchmark/lib/priha.ts';
import { prihaLocalTimingReceipt, type PrihaLocalTiming } from '../../benchmark/lib/priha-local.ts';
import { stageOf } from '../../benchmark/lib/priha-answer.ts';
import { groundingArtifacts } from '@tangleai/grounding';
import { createPrihaReplay } from '../../benchmark/lib/priha-replay.ts';
import { readAiEnv } from '../../benchmark/lib/ai-env.ts';
import { readPrihaLiveReceipts } from '../../benchmark/lib/priha-live-records.ts';
const exec = promisify(execFile), loaded = await loadPrihaFixture(), fixture = loaded.fixture;
const localTimings: PrihaLocalTiming[] = [];
const report = await buildPrihaReport({ loaded, onLocalTiming: value => localTimings.push(value) }), validate = createPrihaValidator();
async function fixtureCopy(run: (root: string, copy: PrihaFixture) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), 'priha-fixture-'));
    try {
        await mkdir(join(root, 'benchmark/fixtures'), { recursive: true });
        await cp('benchmark/fixtures/priha', join(root, 'benchmark/fixtures/priha'), { recursive: true });
        await run(root, structuredClone(fixture));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}
async function manifest(root: string, copy: PrihaFixture) { await writeFile(join(root, 'benchmark/fixtures/priha/manifest.json'), JSON.stringify(copy)); }
describe('the registered PriHA instrument', () => {
    it('the fixture census holds and every byte verifies', () => {
        assert.ok(fixture.sources.length >= 10);
        assert.equal(fixture.questions.length, 32);
        for (const kind of ['abstain', 'refuse'])
            assert.equal(fixture.questions.filter(q => q.kind === kind).length, 4);
        assert.equal(fixture.questions.filter(q => q.kind === 'answerable').length, 24);
        assert.ok(loaded.conversations.length >= 6);
        assert.ok(fixture.web.length >= 7);
        assert.equal(fixture.granularities.length, 3);
        assert.equal(fixture.census.chunks, 88);
        assert.equal(fixture.census.parents, 34);
        assert.equal(fixture.license, 'MIT');
        assert.equal(loaded.replay.hits, fixture.web.length);
        assert.equal(loaded.replay.failed, 0);
        assert.equal(loaded.replay.networkRequests, 0);
    });
    it('refuses a moved corpus byte instead of repairing it', async () => fixtureCopy(async (root, copy) => {
        await writeFile(join(root, 'benchmark/fixtures/priha', copy.sources[0].versions[0].file), 'changed');
        await assert.rejects(loadPrihaFixture(root), /do not match the manifest digest/);
    }));
    it('refuses absent and repeated element quotes', async () => {
        for (const quote of ['absent fixture quote', ' '])
            await fixtureCopy(async (root, copy) => {
                copy.elements[0].quote = quote;
                await manifest(root, copy);
                await assert.rejects(loadPrihaFixture(root), /quote must occur exactly once/);
            });
    });
    it('refuses a forged capture key, redirect and incomplete trace', async () => {
        for (const mutation of [(f: PrihaFixture) => { f.web[0].key = '0'.repeat(64); }, (f: PrihaFixture) => { f.web.find(w => w.redirectTo)!.redirectTo = 'https://other.example/'; }, (f: PrihaFixture) => { f.questions[0].trace.pop(); }])
            await fixtureCopy(async (root, copy) => {
                mutation(copy);
                await manifest(root, copy);
                await assert.rejects(loadPrihaFixture(root), /key drift|redirect header mismatch|trace coverage/);
            });
    });
    it('refuses orphan evidence, script references and parent membership', async () => {
        for (const mutation of [(f: PrihaFixture) => { f.web.find(w => w.elements.length)!.elements[0] = 'unknown'; }, (f: PrihaFixture) => { f.scripts[0].question = 'unknown'; }, (f: PrihaFixture) => { f.chunks.find(c => c.parent)!.parent = 'unknown'; }])
            await fixtureCopy(async (root, copy) => {
                mutation(copy);
                await manifest(root, copy);
                await assert.rejects(loadPrihaFixture(root), /membership|oracle answer/);
            });
    });
    it('the oracle reaches exact ceilings', () => {
        assert.equal(report.gate.passed, true);
        for (const c of report.gate.clauses)
            assert.equal(c.actual, 1, c.metric);
        const oracle = report.rows[0];
        assert.equal(oracle.metrics!.claims.tp, 24);
        assert.equal(oracle.metrics!.claims.fp, 0);
        assert.equal(oracle.metrics!.claims.fn, 0);
        assert.deepEqual(oracle.counts, { planned: 32, answered: 24, abstained: 4, refused: 4, failed: 0, notRun: 0 });
    });
    it('fails before capability acceptance when an oracle loses its evidence', async () => {
        const copy = structuredClone(loaded), answer = copy.fixture.scripts.find(s => s.kind === 'oracle')!.answer as PrihaAnswer;
        answer.claims[0].citations = [];
        const bad = await buildPrihaReport({ loaded: copy });
        assert.equal(bad.gate.passed, false);
        assert.throws(() => requirePrihaCapability(bad, 'instrument'), /gate failed/);
    });
    it('every named bad row ends in its one terminal reason', () => {
        assert.deepEqual(report.badRows.map(r => r.key), PRIHA_BAD_ROWS);
        assert.deepEqual(report.badRows.map(r => r.actual), ['unknown-evidence', 'policy-denied', 'future-evidence', 'unknown-evidence', 'refusal', 'decision-mismatch', 'invented-fact', 'exhausted']);
        for (const row of report.badRows) {
            assert.equal(row.passed, true);
            assert.equal(row.count, 1);
        }
        assert.equal(report.badRows[1].fetchedBytes, 0);
        assert.equal(report.badRows[6].inventedFacts, 1);
    });
    it('retains superseded addresses and uses the unchanged terminal reason order', () => {
        const c = fixture.chunks.find(c => fixture.sources.some(s => s.versions.some(v => v.key === c.version && v.status === 'superseded')) && c.granularity === 'flat-450')!;
        const q = fixture.questions[0], answer = { disposition: 'answer', reason: null, claims: [{ id: 'bad', text: fixture.claims[0].reference, citations: [c.key] }] } as PrihaAnswer;
        assert.ok(prihaCorpus(fixture, 'flat-450').chunk(c.key));
        assert.equal(prihaScoreAnswer(fixture, q, answer, { retrieved: [c.key], supplied: [c.key] }, 'flat-450').citations[0].outcome, 'inactive-version');
        assert.equal(prihaScoreAnswer(fixture, q, answer, { retrieved: [c.key], supplied: [] }, 'flat-450').citations[0].outcome, 'not-supplied');
    });
    it('scores clarification facts by frozen predicates and only observed human turns', () => {
        const c = loaded.conversations.find(c => c.key === 'complex')!;
        assert.equal(scorePrihaConversation(c, { ...c.oracle, facts: ['VOUCHER DESK', 'location'] }).inventedFacts, 0);
        assert.equal(scorePrihaConversation(c, { ...c.oracle, turns: 0 }).inventedFacts, 2);
        assert.equal(scorePrihaConversation(c, { ...c.oracle, facts: [...c.oracle.facts, 'age seventy'] }).inventedFacts, 1);
        assert.equal(scorePrihaConversation(c, { ...c.oracle, queries: ['invented query'] }).plan, 0);
    });
    it('mechanism rows are honest and the capability mapping is fixed', () => {
        assert.deepEqual(report.rows.map(r => r.key), PRIHA_ROWS);
        assert.deepEqual(report.registration.capabilityRows, PRIHA_CAPABILITY_ROWS);
        for (const row of report.rows.slice(1)) {
            assert.equal(row.status, 'scripted');
            assert.ok(row.reason);
            assert.ok(row.metrics);
            assert.equal(row.counts.notRun, 0);
            assert.equal(row.answer.status, 'executed');
        }
        requirePrihaCapability(report, 'instrument');
        requirePrihaCapability(report, 'contracts');
        requirePrihaCapability(report, 'local');
        requirePrihaCapability(report, 'optimizer');
        requirePrihaCapability(report, 'web');
        requirePrihaCapability(report, 'reconcile');
        requirePrihaCapability(report, 'flow');
        assert.equal(report.contracts.failed, 0);
        assert.equal(report.contracts.passed, 26);
        requirePrihaCapability(report, 'complete');
        assert.throws(() => requirePrihaCapability(report, 'invented'), /Unknown/);
        assert.equal(report.decision.state, 'keep-experimental');
        assert.equal(report.decision.tier, 'scripted-tier'); assert.equal(report.decision.defaultChanged, false);
    });
    it('executes the registered optimizer census and counts durable replay, facts and physical calls', () => {
        const [off, on] = report.optimizer.rows;
        assert.equal(report.optimizer.tier, 'scripted'); assert.equal(report.optimizer.failed, 0);
        assert.equal(report.optimizer.providerRequests, 0); assert.equal(report.optimizer.networkRequests, 0);
        assert.equal(off.metrics.planCorrect, 2); assert.equal(off.metrics.triageAccuracy, null);
        assert.equal(on.metrics.triageCorrect, 6); assert.equal(on.metrics.planCorrect, 6);
        assert.equal(on.metrics.calls, 27); assert.equal(on.metrics.tokens, 270); assert.equal(on.metrics.turns, 4);
        assert.equal(on.metrics.resolvedClarifications, 1); assert.equal(on.metrics.exhaustedClarifications, 1);
        assert.equal(on.metrics.clarificationSuccess, 0.5); assert.equal(on.metrics.inventedFacts, 0);
        assert.equal(on.metrics.communityPresent, 1); assert.ok(on.cases.every(row => row.passed));
        for (const row of on.cases.filter(row => row.triage === 'complex')) {
            assert.equal(row.reopens, 2); assert.ok(row.replayedNodes > 0); assert.ok(row.runId);
        }
        assert.deepEqual(on.cases.find(row => row.conversation === 'complex')!.answered, {
            service: 'I mean the voucher desk.', purpose: 'I need its location.',
        });
    });
    it('native report assertions refuse forged optimizer counts, pins and capability acceptance', () => {
        for (const mutate of [
            (value: typeof report) => { value.optimizer.rows[1].metrics.calls++; },
            (value: typeof report) => { value.optimizer.rows[1].cases[0].passed = false; },
            (value: typeof report) => { value.optimizer.rows[1].metrics.planCorrect++; },
            (value: typeof report) => { value.optimizer.catalogRevision = '0'.repeat(64); },
            (value: typeof report) => { value.capabilities.find(row => row.id === 'optimizer')!.passed = false; },
        ]) { const changed = structuredClone(report); mutate(changed); assert.equal(validate(changed).valid, false); }
    });
    it('the optimizer capability fails when a registered proposal invents a user fact', async () => {
        const changed = structuredClone(loaded), conversation = changed.conversations.find(row => row.key === 'simple')!;
        conversation.optimizerScript[1].reply = { queries: [{ text: 'metformin reception', why: 'Bad control.', lanes: { local: true, web: true } }] };
        const failed = await buildPrihaReport({ loaded: changed });
        assert.ok(failed.optimizer.failed > 0); assert.throws(() => requirePrihaCapability(failed, 'optimizer'), /requires simple/);
        assert.equal(failed.optimizer.rows[1].cases.find(row => row.conversation === 'simple')!.outcome, 'failed');
    });
    it('measures both state adapters and rejects forged contract summaries', () => {
        assert.equal(report.contracts.status, 'executed');
        assert.deepEqual(report.contracts.memory, report.contracts.sqlite);
        assert.equal(report.contracts.profileRevision, fixture.profileRevision);
        for (const mutation of [
            (value: typeof report) => { value.contracts.passed++; },
            (value: typeof report) => { value.contracts.memory[0].passed = false; },
            (value: typeof report) => { value.capabilities.find(c => c.id === 'contracts')!.passed = false; },
        ]) { const forged = structuredClone(report); mutation(forged); assert.equal(validate(forged).valid, false); }
    });
    it('measures every frozen local query through real retained child and parent evidence', () => {
        assert.equal(report.local.rows.length, 7); assert.equal(report.local.queries.length, 56);
        assert.equal(report.local.failed, 0); assert.equal(report.local.networkRequests, 0);
        assert.ok(report.local.comparisons.every(c => c.fusedBeatsOrTiesBoth));
        for (const row of report.local.rows) {
            assert.equal(row.cases.length, 56); assert.equal(row.corpus.sources, 12); assert.equal(row.corpus.versions, 13);
            assert.equal(row.metrics.support, 44); assert.equal(row.metrics.eligibleCases, 44);
            assert.ok(row.corpus.retainedChunks > row.corpus.activeChildren);
            assert.ok(row.cases.every(c => c.childIds.every(id => id.startsWith('chk-'))));
            assert.ok(row.cases.every(c => c.parentIds.every(id => id.startsWith('par-'))));
            assert.equal(row.metrics.rebuildMs, null);
        }
        for (const mutation of [
            (r: typeof report) => { r.local.rows[0].metrics.childHits++; },
            (r: typeof report) => { r.local.rows[0].cases.pop(); },
            (r: typeof report) => { r.local.comparisons[0].fusedBeatsOrTiesBoth = false; },
            (r: typeof report) => { r.capabilities.find(c => c.id === 'local')!.passed = false; },
        ]) { const changed = structuredClone(report); mutation(changed); assert.equal(validate(changed).valid, false); }
    });
    it('keeps measured timing in a source-bound receipt outside deterministic scores', async () => {
        const receipt = await prihaLocalTimingReceipt(report, localTimings);
        assert.equal(receipt.rows.length, 7); assert.equal(receipt.samples.length, 392);
        assert.equal(receipt.reportId, report.reportId); assert.equal(receipt.sourceSha256, report.source.sha256);
        assert.ok(receipt.rows.every(r => r.count === 56 && r.p95Ms !== null && r.p95Ms > 0));
        assert.ok(receipt.rows.filter(r => r.row.endsWith('/fused')).every(r => r.rebuildMs > 0));
        const { receiptId, ...payload } = receipt; assert.equal(receiptId, await canonicalSha256(payload));
        assert.ok((await prihaLocalTimingReceipt(report, [])).rows.every(r => !r.passed));
    });
    it('refuses a rehashed local score forgery through independent reproduction', async () => {
        const changed = structuredClone(report); changed.local.rows[0].metrics.childRecall = 0;
        changed.reportId = await reportIdOf(changed);
        await assert.rejects(validatePrihaReport(changed), /does not reproduce/);
    });
    it('the report binds the immutable handoff', async () => {
        const raw = JSON.parse(await readFile('benchmark/results/grounding-handoff.json', 'utf8'));
        assert.deepEqual(report.registration.control, Object.fromEntries(Object.keys(report.registration.control).map(k => [k, raw.handoff.identities[k]])));
        assert.equal(report.registration.handoffReportId, raw.reportId);
        const root = await mkdtemp(join(tmpdir(), 'priha-handoff-'));
        try {
            await assert.rejects(loadPrihaControl(root), /ENOENT/);
            await mkdir(join(root, 'benchmark/results'), { recursive: true });
            const file = join(root, 'benchmark/results/grounding-handoff.json');
            await writeFile(file, JSON.stringify({ ...raw, document: 'foreign' }));
            await assert.rejects(loadPrihaControl(root), /immutable grounding-handoff/);
            raw.reportId = 'a'.repeat(64);
            await writeFile(file, JSON.stringify(raw));
            await assert.rejects(loadPrihaControl(root), /identity does not match/);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it('the schema refuses forged summaries, row counts, terminal counts and adoption', () => {
        const mutations = [(r: typeof report) => { r.summary.cases++; }, (r: typeof report) => { r.rows[0].counts.answered++; }, (r: typeof report) => { r.badRows[0].count = 0; }, (r: typeof report) => { r.decision.state = 'adopt'; }];
        for (const mutate of mutations) {
            const bad = structuredClone(report);
            mutate(bad);
            assert.equal(validate(bad).valid, false);
        }
    });
    it('refuses forged values even after the report is rehashed', async () => {
        await validatePrihaReport(report);
        const bad = structuredClone(report);
        bad.rows[0].metrics!.localRecall = 0;
        bad.reportId = await reportIdOf(bad);
        await assert.rejects(validatePrihaReport(bad), /does not reproduce/);
        const identity = structuredClone(report);
        identity.registration.control.sourceSha256 = 'a'.repeat(64);
        identity.registration.registrationId = await registrationIdOf(identity.registration);
        identity.live.plan.registrationId = identity.registration.registrationId;
        const { planId: _, ...payload } = identity.live.plan; identity.live.plan.planId = await canonicalSha256(payload);
        identity.reportId = await reportIdOf(identity);
        await assert.rejects(validatePrihaReport(identity), /does not reproduce/);
    });
    it('two runs are byte-identical and never reach the network', async () => {
        const old = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = async () => { calls++; throw Error('network forbidden'); };
        try {
            const second = await buildPrihaReport();
            assert.equal(renderPrihaReport(second), renderPrihaReport(report));
            assert.equal(renderPrihaDocument(second), renderPrihaDocument(report));
            assert.equal(calls, 0);
        }
        finally {
            globalThis.fetch = old;
        }
    });
    it('committed report and Markdown equal the measured command artifacts', async () => {
        assert.equal(await readFile('benchmark/results/priha.json', 'utf8'), renderPrihaReport(report));
        assert.equal(await readFile('docs/PRIHA_BENCHMARK.md', 'utf8'), renderPrihaDocument(report, await readPrihaLiveReceipts()));
    });
    it('replays exact bytes repeatedly, with counted misses and no fallback', async () => {
        const replay = createPrihaReplay(fixture.web, loaded.bodies), row = fixture.web.find(r => r.kind === 'document' && r.status === 200)!;
        for (let i = 0; i < 2; i++) {
            const response = await replay.fetchFor('document')(row.url);
            assert.deepEqual(new Uint8Array(await response.arrayBuffer()), loaded.bodies.get(row.file));
        }
        await assert.rejects(replay.fetchFor('document')('https://missing.example'), /no registered/);
        await assert.rejects(replay.fetchFor('document')(row.url, { method: 'POST' }), /only registered GET/);
        assert.deepEqual(replay.stats(), { requests: 4, hits: 2, failed: 2, bytes: loaded.bodies.get(row.file)!.length * 2, networkRequests: 0 });
        const bytes = new Map(loaded.bodies);
        bytes.set(row.file, new Uint8Array([1]));
        await assert.rejects(createPrihaReplay(fixture.web, bytes).fetchFor('document')(row.url), /digest/);
    });
    it('freezes a credential-free dry plan and requires an executable wire plus exact authorization', async () => {
        const plan = await planPrihaLive(report), again = await planPrihaLive(report);
        assert.deepEqual(plan, again);
        assert.equal(validate(plan).valid, true);
        const { planId, ...body } = plan.plan;
        assert.equal(planId, await canonicalSha256(body));
        assert.equal(plan.physicalRequests, 0);
        assert.equal(authorizePrihaLive(plan), 'skipped');
        assert.throws(() => authorizePrihaLive(plan, 'wrong'), /does not match/);
        assert.equal(authorizePrihaLive(plan, planId), 'skipped');
        const env = readAiEnv({ TANGLE_AI_MODEL: 'fixture/model', OPENROUTER_AI_KEY: 'secret-not-in-plan', TANGLE_AI_MAX_CALLS: '1920' });
        const configured = await planPrihaLive(report, env);
        assert.ok(!JSON.stringify(configured).includes('secret-not-in-plan'));
        assert.equal(authorizePrihaLive(configured, configured.plan.planId), 'execute');
        assert.equal(configured.plan.maxFreshCalls, 1920); assert.equal(configured.plan.maxSearches, 288); assert.equal(configured.plan.maxFetches, 576);
        assert.equal(configured.plan.maxWebHttpRequests, 0);
        await assert.rejects(planPrihaLive(report, { ...env, baseUrl: 'https://example.test/?secret=not-safe' }), /credential-free/);
    });
    it('the CLI reproduces files, checks without writing and refuses unsupported gates before output', async () => {
        const root = await mkdtemp(join(tmpdir(), 'priha-cli-'));
        try {
            const a = join(root, 'a.json'), b = join(root, 'b.md');
            await exec(process.execPath, ['benchmark/priha.ts', '--json', a, '--md', b]);
            assert.equal(await readFile(a, 'utf8'), renderPrihaReport(report));
            assert.equal(await readFile(b, 'utf8'), renderPrihaDocument(report, await readPrihaLiveReceipts()));
            await exec(process.execPath, ['benchmark/priha.ts', '--check', '--json', a, '--md', b]);
            for (const flags of [['--require', 'unknown-capability'], ['--unknown']])
                await assert.rejects(exec(process.execPath, ['benchmark/priha.ts', ...flags]), (error: unknown) => { const e = error as Error & {
                    code: number;
                    stdout: string;
                }; assert.equal(e.code, 1); assert.equal(e.stdout, ''); return true; });
            await writeFile(a, 'forged');
            await assert.rejects(exec(process.execPath, ['benchmark/priha.ts', '--check', '--json', a, '--md', b]), /artifact drift/);
            assert.equal(await readFile(a, 'utf8'), 'forged');
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

it('executes the web component independently with exact replay and denied-origin zero requests', () => {
    assert.equal(report.web.failed, 0); assert.equal(report.web.rows.length, 3); assert.equal(report.web.scriptedRequests, 105);
    for (const row of report.web.rows) {
        assert.equal(row.metrics.cases, 13); assert.equal(row.metrics.passed, 13); assert.equal(row.metrics.required, 2); assert.equal(row.metrics.recovered, 2);
        assert.equal(row.metrics.denied, 4); assert.equal(row.metrics.redirectDenied, 1); assert.equal(row.metrics.snippets, 17);
        assert.equal(row.metrics.deniedRequests, 0); assert.equal(row.metrics.replayFetches, 0); assert.equal(row.metrics.replayCalls, 0);
        assert.ok(row.cases.every(value => value.replayIdentical && value.timeFactsCorrect));
        assert.deepEqual(row.cases.filter(value => value.id.startsWith('budget-')).map(value => value.stopReason), ['budget-turns','budget-tokens','budget-ms','budget-searches','budget-fetches','budget-bytes']);
    }
});
it('measures all registered ablations and retains both the scored and gold-free denominators', () => {
    assert.equal(report.ablation.failed, 0); assert.equal(report.ablation.rows.length, 4);
    for (const row of report.ablation.rows) { assert.equal(row.cases.length, 32); assert.equal(row.runs.length, 32); assert.ok(row.runs.every(run => run.reopened)); }
    assert.equal(report.pairing.comparisons.length, 9);
    for (const pair of report.pairing.comparisons) {
        assert.equal(pair.outcomes.length, 32); assert.equal(pair.pairs, 24); assert.equal(pair.excludedNull, 8);
        assert.equal(pair.wins + pair.losses + pair.ties, 24);
    }
    const full = report.flow.rows.find(row => row.key === 'priha-full')!, hypothesis = report.ablation.rows.find(row => row.key === 'priha-hypothesis-weights')!;
    assert.deepEqual(hypothesis.metrics, full.metrics); assert.equal(hypothesis.calls, full.calls); assert.equal(hypothesis.tokens, full.tokens);
    assert.equal(report.safety.suites.length, 9); assert.equal(report.safety.cases.length, 11); assert.equal(report.safety.violations, 0);
    assert.equal(report.safety.setup[0].factRetained, true);
    const rejected = report.safety.cases.find(row => row.id === 'personalization-leakage:plan')!;
    assert.equal(rejected.run.disposition, 'failure'); assert.equal(rejected.run.failure, 'plan-unavailable');
    assert.deepEqual(rejected.planTexts, []); assert.ok(rejected.checks.every(check => check.passed));
    assert.equal(report.decision.defaultChanged, false);
});
it('the decision cannot be forged independently of its cases, comparisons, budgets or safety observations', () => {
    for (const mutate of [
        (value: typeof report) => { value.rows[1].metrics!.claims.microF1 = 1; },
        (value: typeof report) => { (value.ablation.rows[0].metrics.claims as { meanF1: number }).meanF1 = 1; },
        (value: typeof report) => { value.pairing.comparisons[0].outcomes[0].treatmentF1 = 0.123; },
        (value: typeof report) => { value.flow.rows.find(row => row.key === 'priha-full')!.runs[0].contextTokens = 1501; },
        (value: typeof report) => { value.safety.cases[0].checks[0].actual = 'forged'; },
        (value: typeof report) => { value.safety.suites[0].violations++; },
        (value: typeof report) => { value.decision.clauses.find(row => row.id === 'independent-claim-delta')!.passed = true; },
        (value: typeof report) => { value.decision.defaultChanged = true as never; },
        (value: typeof report) => { value.live.plan.maxFreshCalls++; },
    ]) { const changed = structuredClone(report); mutate(changed); assert.equal(validate(changed).valid, false); }
});
it('live dry, skipped, mismatched and changed-source plans make zero transport calls', async () => {
    const env = readAiEnv({ OPENROUTER_AI_KEY: 'fake-priha-key', TANGLE_AI_MODEL: 'fixture/model', TANGLE_AI_MAX_CALLS: '1920' });
    let requests = 0; const fetch = async () => { requests++; throw Error('Unapproved request.'); };
    const plan = await planPrihaLive(report, env);
    assert.equal((await runPrihaLive(report, plan, { env, fetch })).authorization, 'dry-run');
    await assert.rejects(runPrihaLive(report, plan, { env, fetch, authorize: 'wrong' }), /does not match/);
    const empty = readAiEnv({}), skipped = await planPrihaLive(report, empty);
    assert.equal((await runPrihaLive(report, skipped, { env: empty, fetch, authorize: skipped.plan.planId })).authorization, 'skipped');
    const forged = structuredClone(plan); forged.plan.sourceSha256 = '0'.repeat(64);
    await assert.rejects(runPrihaLive(report, forged, { env, fetch, authorize: forged.plan.planId }), /source or fixture changed/);
    const captured = await planPrihaLive(report, env, { webLive: true, searxBase: 'https://search.fixture.invalid' });
    assert.equal(captured.plan.maxWebHttpRequests, 7200); assert.equal(captured.plan.maxWebBytes, 9600000);
    assert.notEqual(captured.plan.planId, plan.plan.planId); assert.equal(requests, 0);
    const first = await exec(process.execPath, ['benchmark/priha.ts', '--live'], { env: { PATH: process.env.PATH } });
    const second = await exec(process.execPath, ['benchmark/priha.ts', '--live'], { env: { PATH: process.env.PATH } });
    assert.equal(first.stdout, second.stdout); assert.match(first.stdout, /skipped: 0 physical requests/);
    assert.match(first.stdout, new RegExp(skipped.plan.planId));
});
it('exact live authorization executes every question through the real wire and host with an injected fake provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'priha-authorized-'));
    const env = readAiEnv({ OPENROUTER_AI_KEY: 'fake-priha-key', TANGLE_AI_MODEL: 'fixture/model', TANGLE_AI_MAX_CALLS: '1920' });
    const plan = await planPrihaLive(report, env, { webLive: true, searxBase: 'https://search.fixture.invalid' }); let requests = 0, webRequests = 0;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
        requests++; const body = JSON.parse(String(init?.body));
        assert.equal(body.max_tokens, 1024); assert.equal(body.stream, false); assert.equal(body.reasoning.enabled, false);
        const artifact = groundingArtifacts.prompts.find(prompt => body.messages.some((message: { role: string; content: string }) =>
            message.role === 'system' && message.content.includes(prompt.role.instructions)));
        assert.ok(artifact);
        if (artifact.id === 'grounding-web-agent' && !body.messages.some((message: { role: string }) => message.role === 'tool'))
            return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'fixture-fetch', type: 'function',
                function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://official.harbour.example/archive' }) } }] }, finish_reason: 'tool_calls' }],
                usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }, model: 'fixture/model' }), { headers: { 'content-type': 'application/json' } });
        const content = artifact.id === 'grounding-triage' ? { triage: 'simple', reason: 'Injected provider response.', requiredFields: [], intents: ['administrative-information'] }
            : artifact.id === 'grounding-plan' ? { queries: [{ text: 'Harbour administrative information', why: 'Injected provider response.', lanes: { local: true, web: true } }] }
            : artifact.id === 'grounding-web-sufficiency' ? { sufficient: false, missing: ['Evidence'], refinedQueries: [], reason: 'Injected provider response.' }
            : artifact.id === 'grounding-reconcile' ? { decisions: [] }
            : artifact.id === 'grounding-repair' ? []
            : { disposition: 'abstain', claims: [], reason: 'The injected provider supplied no supported answer.' };
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }, model: 'fixture/model' }), { headers: { 'content-type': 'application/json' } });
    };
    try {
        const result = await runPrihaLive(report, plan, { env, authorize: plan.plan.planId, fetch, lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            webFetch: async input => { webRequests++; const url = new URL(String(input)); assert.equal(url.hostname, 'official.harbour.example');
                return new Response(url.pathname === '/robots.txt' ? 'User-agent: *\nAllow: /' : '<html><main><h1>Archive</h1><p>The archive desk is in Square Hall.</p></main></html>',
                    { headers: { 'content-type': url.pathname === '/robots.txt' ? 'text/plain' : 'text/html' } }); }, databaseDirectory: join(directory, 'execution'),
            now: () => new Date('2026-10-01T12:00:00.000Z'), clock: () => 0 });
        assert.equal(result.authorization, 'execute'); assert.equal(result.physicalRequests, requests + webRequests); assert.ok(requests > 0 && requests <= 1920);
        const execution = result.execution!; assert.equal(execution.providerRequests, requests); assert.equal(execution.webRequests, webRequests); assert.ok(webRequests > 0); assert.ok(execution.capture.length > 0); assert.ok(execution.webBytes > 0); assert.equal(execution.rows.length, 5);
        for (const row of execution.rows) { assert.equal(row.cases.length, 32); assert.equal(row.runs.length, 32); assert.ok(row.runs.every(run => run.reopened)); }
        assert.ok(execution.rows.every(row => (row.metrics.claims as { tp: number }).tp === 0), 'Live replies must never be substituted with the scripted gold recipes.');
        assert.equal(execution.comparisons.length, 5); assert.equal(validate(execution).valid, true);
        assert.ok(!JSON.stringify(execution).includes('fake-priha-key'));
        const { executionId, ...payload } = execution; assert.equal(executionId, await canonicalSha256(payload));
        const results = join(directory, 'benchmark/results'); await mkdir(results, { recursive: true });
        const receiptPath = join(results, `priha-live-${execution.at.slice(0, 10)}-${executionId}.json`);
        await writeFile(receiptPath, JSON.stringify({ plan, execution }));
        const receipts = await readPrihaLiveReceipts(directory), document = renderPrihaDocument(report, receipts);
        assert.equal(receipts.length, 1); assert.match(document, /Dated live execution/); assert.match(document, /Live treatment/);
        assert.ok(document.includes(executionId)); assert.match(document, /keep-experimental/);
        const before = requests;
        await assert.rejects(runPrihaLive(report, plan, { env, authorize: plan.plan.planId, fetch, databaseDirectory: join(directory, 'execution') }), /EEXIST/);
        assert.equal(requests, before);
        const forged = structuredClone(execution); forged.sourceSha256 = '0'.repeat(64);
        await writeFile(receiptPath, JSON.stringify({ plan, execution: forged }));
        await assert.rejects(readPrihaLiveReceipts(directory), /identity mismatch/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
it('native web assertions refuse forged counts, identities and capability acceptance', () => {
    for (const alter of [
        (value: typeof report) => { value.web.rows[0].metrics.calls++; },
        (value: typeof report) => { value.web.rows[0].metrics.deniedRequests++; },
        (value: typeof report) => { value.web.rows[0].cases[0].passed = false; },
        (value: typeof report) => { value.web.executionId = '0'.repeat(64); },
        (value: typeof report) => { value.capabilities.find(row => row.id === 'web')!.passed = false; },
    ]) { const copy = structuredClone(report); alter(copy); assert.equal(validate(copy).valid, false); }
});
it('the web gate rejects an injected script that fetches a denied page in place of its required support', async () => {
    const changed = { ...loaded, webExecution: structuredClone(loaded.webExecution) };
    changed.webExecution.cases[0].script[1].reply.toolCalls![0].arguments = JSON.stringify({ url: 'https://outside.example/forged' });
    const result = await buildPrihaReport({ loaded: changed });
    assert.ok(result.web.failed > 0); assert.throws(() => requirePrihaCapability(result, 'web'), /requires.*booking/);
    assert.equal(result.web.rows[0].cases[0].recovered, 0); assert.equal(result.web.rows[0].cases[0].deniedRequests, 0);
});

it('scores five real scripted answer treatments with closed conflict and reference controls', () => {
    assert.equal(report.answers.tier, 'scripted'); assert.equal(report.answers.runs.length, 160);
    assert.equal(report.answers.failed, 0); assert.equal(report.answers.leakage, 0); assert.equal(report.answers.safety.length, 10);
    assert.equal(report.answers.conflicts.length, 7); assert.ok(report.answers.runs.every(run => run.reopened));
    assert.ok(report.answers.safety.every(row => row.passed && row.code === 'TGRD1008' && row.visibleClaims === 0));
    assert.equal(report.answers.providerRequests, 0); assert.equal(report.answers.networkRequests, 0);
    assert.ok(report.rows.slice(1).every(row => row.metrics!.claims.fp === 0 && row.metrics!.claims.fn > 0));
    assert.ok(report.answers.runs.filter(run => run.row === 'drag-no-optimizer').every(run => run.queries.length === 1 && run.queries[0] === fixture.questions.find(q => q.key === run.question)!.text));
    for (const mutation of [
        (value: typeof report) => { value.answers.scriptedRequests++; },
        (value: typeof report) => { value.answers.safety[0].passed = false; },
        (value: typeof report) => { value.answers.conflicts[0].actual = 'fabricated'; },
        (value: typeof report) => { value.answers.executionId = '0'.repeat(64); },
        (value: typeof report) => { value.answers.leakage++; },
        (value: typeof report) => { value.capabilities.find(row => row.id === 'reconcile')!.passed = false; },
    ]) { const changed = structuredClone(report); mutation(changed); assert.equal(validate(changed).valid, false); }
});

it('classifies the scripted stage by its system prompt while preserving quoted content', () => {
    const sufficiency = groundingArtifacts.prompts.find(row => row.id === 'grounding-web-sufficiency')!;
    const agent = groundingArtifacts.prompts.find(row => row.id === 'grounding-web-agent')!;
    assert.equal(stageOf({ messages: [{ role: 'system', content: sufficiency.role.instructions },
        { role: 'user', content: agent.role.instructions }] }, loaded.answerExecution), 'web-sufficiency');
    assert.throws(() => stageOf({ messages: [{ role: 'user', content: agent.role.instructions }] }, loaded.answerExecution), /Unregistered/);
});
it('executes every treatment and recovery path through native durable workflow stages', () => {
    assert.equal(report.flow.failed, 0); assert.equal(report.flow.rows.length, 5); assert.equal(report.flow.paths.length, 6);
    assert.equal(report.flow.crashes.length, 84); assert.equal(report.flow.providerRequests, 0); assert.equal(report.flow.networkRequests, 0);
    for (const row of report.flow.rows) {
        assert.ok(row.passed && row.componentParity && row.frozenQualityParity && row.frozenCallsParity);
        assert.ok(row.runs.every(run => run.reopened));
        assert.equal(row.tokenCorrection, ['web-only', 'drag-no-optimizer', 'priha-full'].includes(row.key) ? 290 : 0);
    }
    for (const crash of report.flow.crashes) {
        assert.ok(crash.passed && crash.identical && crash.replayed + crash.restored > 0);
        assert.equal(crash.duplicateCalls, 0); assert.equal(crash.duplicateRequests, 0);
    }
    assert.ok(report.flow.paths.every(row => row.passed));
    for (const alter of [
        (value: typeof report) => { value.flow.rows[0].calls++; },
        (value: typeof report) => { value.flow.crashes[0].duplicateRequests++; },
        (value: typeof report) => { value.flow.paths[0].passed = false; },
        (value: typeof report) => { value.capabilities.find(row => row.id === 'flow')!.passed = false; },
    ]) { const copy = structuredClone(report); alter(copy); assert.equal(validate(copy).valid, false); }
});
