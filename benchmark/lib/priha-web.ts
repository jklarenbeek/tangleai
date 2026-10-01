/** Execute each registered web component independently; the gold never selects evidence. */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createWebLane, createReplayWebTransport, groundingArtifacts, evaluateProfileRules, groundingIdOf,
    type GroundingProfile } from '@tangleai/grounding';
import { createGroundingStore, openTangleDb } from '@tangleai/store';
import { prihaWebReplayRecords } from './priha-replay.ts';
import { createPrihaContractFixture, contractMust } from './priha-contracts.ts';
import type { LoadedPrihaFixture } from './priha.ts';
import type { PrihaWebReport, PrihaWebCase, PrihaWebRow, PrihaWebMetrics } from './priha.types.ts';
const AT = '2026-06-01T00:00:00.000Z';
function summarize(key: PrihaWebRow['key'], cases: PrihaWebCase[]): PrihaWebRow {
    const numbers = ['required','recovered','admitted','denied','redirectDenied','failed','snippets','searches','fetches','calls','tokens','bytes','requests','replayFetches','replayCalls','deniedRequests'] as const;
    const totals = Object.fromEntries(numbers.map(name => [name, cases.reduce((sum, row) => sum + row[name], 0)])) as Pick<PrihaWebMetrics, typeof numbers[number]>;
    return { key, status: 'executed', cases, metrics: { ...totals, cases: cases.length, recall: totals.required ? totals.recovered / totals.required : null,
        refined: cases.filter(row => row.refined).length, sufficient: cases.filter(row => row.sufficient).length, passed: cases.filter(row => row.passed).length } };
}
export async function measurePrihaWeb(loaded: LoadedPrihaFixture, profile: GroundingProfile): Promise<PrihaWebReport> {
    const registration = loaded.webExecution, records = await prihaWebReplayRecords(loaded.fixture.web, registration, loaded.bodies);
    const directory = await mkdtemp(join(tmpdir(), 'priha-web-')), rows: PrihaWebRow[] = [];
    let transportRevision = '';
    try {
        for (const key of ['web-only','drag-no-optimizer','priha-full'] as const) {
            const cases: PrihaWebCase[] = [];
            for (const registered of registration.cases) {
                const row: PrihaWebCase = { id: registered.id, question: registered.question, runId: null, stopReason: 'not-run', required: registered.required.length, recovered: 0,
                    evidence: [], hashes: [], admitted: 0, denied: 0, redirectDenied: 0, failed: 0, snippets: 0, searches: 0, fetches: 0, calls: 0, tokens: 0, bytes: 0, requests: 0,
                    replayFetches: 0, replayCalls: 0, deniedRequests: 0, refined: false, sufficient: false, replayIdentical: false, timeFactsCorrect: false, passed: false, error: null };
                const transport = await createReplayWebTransport(records, { searxBase: registration.searxBase }); transportRevision = transport.revision;
                const path = join(directory, key + '-' + registered.id + '.sqlite'); let db = await openTangleDb({ path }), store = createGroundingStore(db);
                let physicalCalls = 0;
                const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
                    const step = registered.script[physicalCalls++], messages = (request as { messages: Array<{ content: unknown }> }).messages;
                    if (!step) throw Error('Unregistered web model request: ' + registered.id);
                    const artifact = groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-' + step.stage);
                    if (!artifact || artifact.revision !== step.promptRevision || !messages.some(message => typeof message.content === 'string' && message.content.includes(artifact.role.instructions)))
                        throw Error('Web prompt or stage differs from the registered script.');
                    return { message: structuredClone(step.reply), usage: { total_tokens: 10 }, finishReason: 'stop' };
                } };
                const lane = () => createWebLane({ profile, client, modelIdentity: null, transport, store, budgets: registered.budgets, clock: () => 0, now: () => AT });
                try {
                    contractMust(await store.putProfile(profile));
                    let session = contractMust(await store.createSession({ conversationId: key + ':' + registered.id, profileId: profile.id, profileRevision: profile.revision }));
                    const fixture = await createPrihaContractFixture(profile, session);
                    fixture.plan.queries = [{ id: 'web-query-' + registered.id, text: registered.query, why: 'Registered web software case.', lanes: { local: false, web: true }, ruleIds: ['in-scope'] }];
                    fixture.plan.id = await groundingIdOf('plan', { intentId: fixture.intent.id, queries: fixture.plan.queries }); fixture.plan.profileRevision = profile.revision;
                    contractMust(await store.putIntent(fixture.intent)); contractMust(await store.putPlan(fixture.plan));
                    session = contractMust(await store.transitionSession(session.id, { kind: 'triage' }, session.revision));
                    session = contractMust(await store.transitionSession(session.id, { kind: 'plan', intentId: fixture.intent.id, planId: fixture.plan.id }, session.revision));
                    const result = await lane().retrieve(session, fixture.plan.queries[0]!.id);
                    if (!result.ok) throw Error(JSON.stringify(result.issue));
                    const run = result.run; row.runId = run.id; row.stopReason = run.stopReason;
                    const descriptors = [...loaded.fixture.web, ...registration.records];
                    row.evidence = result.candidates.map(candidate => descriptors.find(record => 'sha256' in candidate.address && record.sha256 === candidate.address.sha256 && record.url === candidate.address.finalUrl)?.name ?? 'unregistered');
                    row.hashes = result.candidates.map(candidate => 'sha256' in candidate.address ? candidate.address.sha256 : '');
                    row.recovered = registered.required.filter(id => { const element = loaded.fixture.elements.find(row => row.key === id)!; return result.candidates.some(candidate => candidate.excerpt.includes(element.quote)); }).length;
                    row.admitted = run.attempts.reduce((sum, attempt) => sum + attempt.admitted.length, 0);
                    row.denied = run.attempts.reduce((sum, attempt) => sum + attempt.denied.length, 0);
                    row.redirectDenied = run.attempts.flatMap(attempt => attempt.denied).filter(denied => (denied.hop ?? 0) > 0).length;
                    row.failed = run.attempts.reduce((sum, attempt) => sum + attempt.failed.length, 0);
                    row.snippets = run.attempts.reduce((sum, attempt) => sum + attempt.snippets, 0);
                    for (const name of ['searches','fetches','calls','tokens','bytes'] as const) row[name] = run.spend[name];
                    row.requests = transport.stats().requests;
                    const policy = evaluateProfileRules(profile, { text: '' }); row.deniedRequests = (run.requests ?? []).filter(request => !policy.authorityOf(request.url)).length;
                    row.refined = run.attempts.length > 1; row.sufficient = run.stopReason === 'sufficient';
                    row.timeFactsCorrect = result.candidates.every((candidate, index) => {
                        const name = row.evidence[index];
                        if (name === 'dated-future') return candidate.times.provenance === 'metadata' && candidate.times.effectiveAt === '2027-01-01T00:00:00.000Z';
                        if (name === 'dated-expired') return candidate.times.provenance === 'metadata' && candidate.times.expiresAt === '2025-01-01T00:00:00.000Z';
                        return equalsJson(candidate.times, { provenance: null }) && (name !== 'last-modified' || candidate.transport?.lastModified === 'Fri, 01 May 2026 00:00:00 GMT');
                    });
                    const calls = physicalCalls, requests = transport.stats().requests;
                    await db.close(); db = await openTangleDb({ path }); store = createGroundingStore(db);
                    const replay = await lane().retrieve(session, fixture.plan.queries[0]!.id);
                    row.replayFetches = transport.stats().requests - requests; row.replayCalls = physicalCalls - calls;
                    row.replayIdentical = replay.ok && replay.replayed && equalsJson(replay.run, result.run) && equalsJson(replay.candidates, result.candidates);
                    const expected = registered.expected;
                    row.passed = run.issue === undefined && row.stopReason === expected.stopReason && equalsJson([...row.evidence].sort(), [...expected.evidence].sort())
                        && row.searches === expected.searches && row.fetches === expected.fetches && row.denied === expected.denied && row.redirectDenied === expected.redirectDenied
                        && row.failed === expected.failed && row.required === row.recovered && row.deniedRequests === 0 && row.timeFactsCorrect && row.replayIdentical
                        && row.replayFetches === 0 && row.replayCalls === 0 && row.calls === registered.script.length && physicalCalls === row.calls && row.tokens === 10 * row.calls;
                    if (!row.passed) row.error = run.issue?.detail ?? 'Measured web case differs from its registered expectations.';
                    if ((await store.readTrace(session.id))!.answers.length) throw Error('The web lane synthesized an answer.');
                } catch (cause) { row.error = cause instanceof Error ? cause.message : String(cause); row.passed = false; }
                finally { await db.close(); }
                cases.push(row);
            }
            rows.push(summarize(key, cases));
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
    return { status: 'executed', tier: 'scripted', executionId: await canonicalSha256(registration), catalogRevision: groundingArtifacts.revision, transportRevision,
        rankerId: 'web-rank/1', rows, failed: rows.reduce((sum, row) => sum + row.cases.filter(value => !value.passed).length, 0),
        scriptedRequests: rows.reduce((sum, row) => sum + row.metrics.calls, 0), providerRequests: 0, networkRequests: 0, latency: 'not-measured',
        limitations: 'Each treatment independently executes the same registered web component and safety cases. Original date annotations are not injected into runtime evidence; supplemental HTML registers actual metadata. This is fetched-evidence recall and control-flow coverage, not end-to-end answering or live model quality. Replay closes and reopens SQLite. The deterministic clock is not measured latency.' };
}
