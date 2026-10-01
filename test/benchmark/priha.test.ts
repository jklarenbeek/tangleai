/** A fixed dual-retrieval experiment must refuse hidden or forged denominators. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { buildPrihaReport, loadPrihaFixture, loadPrihaControl, createPrihaValidator, requirePrihaCapability, PRIHA_ROWS, PRIHA_BAD_ROWS, PRIHA_CAPABILITY_ROWS, renderPrihaDocument, renderPrihaReport, planPrihaLive, authorizePrihaLive, prihaCorpus, prihaScoreAnswer, scorePrihaConversation, validatePrihaReport, reportIdOf, registrationIdOf, type PrihaAnswer, type PrihaFixture, } from '../../benchmark/lib/priha.ts';
import { prihaLocalTimingReceipt, type PrihaLocalTiming } from '../../benchmark/lib/priha-local.ts';
import { createPrihaReplay } from '../../benchmark/lib/priha-replay.ts';
import { readAiEnv } from '../../benchmark/lib/ai-env.ts';
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
            assert.equal(row.status, ['flat-semantic', 'local-hybrid'].includes(row.key) ? 'not-run' : 'implementation-missing');
            assert.ok(row.reason);
            assert.equal(row.metrics, null);
            assert.equal(row.counts.notRun, 32);
        }
        requirePrihaCapability(report, 'instrument');
        requirePrihaCapability(report, 'contracts');
        requirePrihaCapability(report, 'local');
        assert.equal(report.contracts.failed, 0);
        assert.equal(report.contracts.passed, 26);
        for (const c of report.capabilities.slice(3))
            assert.throws(() => requirePrihaCapability(report, c.id), /requires/);
        assert.throws(() => requirePrihaCapability(report, 'invented'), /Unknown/);
        assert.equal(report.decision.state, 'not-evaluated');
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
        assert.equal(await readFile('docs/PRIHA_BENCHMARK.md', 'utf8'), renderPrihaDocument(report));
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
    it('freezes a credential-free dry plan and refuses even matching spending authorization', async () => {
        const plan = await planPrihaLive(report), again = await planPrihaLive(report);
        assert.deepEqual(plan, again);
        assert.equal(validate(plan).valid, true);
        const { planId, ...body } = plan.plan;
        assert.equal(planId, await canonicalSha256(body));
        assert.equal(plan.physicalRequests, 0);
        assert.equal(authorizePrihaLive(plan), 'skipped');
        assert.throws(() => authorizePrihaLive(plan, 'wrong'), /does not match/);
        assert.throws(() => authorizePrihaLive(plan, planId), /no executable mechanism row/);
        const env = readAiEnv({ AI_PROVIDER: 'openai', AI_MODEL: 'fixture', OPENAI_API_KEY: 'secret-not-in-plan' });
        const configured = await planPrihaLive(report, env);
        assert.ok(!JSON.stringify(configured).includes('secret-not-in-plan'));
        await assert.rejects(planPrihaLive(report, { ...env, baseUrl: 'https://example.test/?secret=not-safe' }), /credential-free/);
    });
    it('the CLI reproduces files, checks without writing and refuses unsupported gates before output', async () => {
        const root = await mkdtemp(join(tmpdir(), 'priha-cli-'));
        try {
            const a = join(root, 'a.json'), b = join(root, 'b.md'), c = join(root, 'c.json'), d = join(root, 'd.md');
            await exec(process.execPath, ['benchmark/priha.ts', '--json', a, '--md', b]);
            await exec(process.execPath, ['benchmark/priha.ts', '--json', c, '--md', d]);
            assert.equal(await readFile(a, 'utf8'), await readFile(c, 'utf8'));
            assert.equal(await readFile(b, 'utf8'), await readFile(d, 'utf8'));
            await exec(process.execPath, ['benchmark/priha.ts', '--check', '--json', a, '--md', b]);
            for (const flags of [['--require', 'optimizer'], ['--unknown']])
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
