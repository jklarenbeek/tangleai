import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPurchaseGuard, verifyPolicyReport, verifyPolicyDataset, verifyPurchaseSnapshot, validatePhase } from '../../benchmark/lib/policy-execution.ts';
import { comparisonOf, POLICY_OBJECTIVE, reportIdOf, type LocomoPolicy } from '../../benchmark/lib/locomo-policy.ts';
const fixture = async () => JSON.parse(await readFile('benchmark/results/locomo-policy-screen.json', 'utf8')) as LocomoPolicy;
it('a process that planned before another writer finished cannot replace its purchase journal', () => {
  const expected = { reportId: 'first', journal: { inference: 'a', source: 'b', ceiling: 2, requests: [], cacheWrites: {} } };
  verifyPurchaseSnapshot(expected, structuredClone(expected));
  assert.throws(() => verifyPurchaseSnapshot(expected, { ...expected, journal: { ...expected.journal, requests: [{ kind: 'chat', status: 200, request: 'r' }] } }), /state changed/);
  assert.throws(() => verifyPurchaseSnapshot(expected, { ...expected, reportId: 'completed' }), /state changed/);
});
it('a completed confirmation is immutable, including an explicit cell rerun', async () => {
  const report = JSON.parse(await readFile('benchmark/results/locomo-policy.json', 'utf8')) as LocomoPolicy;
  assert.throws(() => validatePhase(report, 'confirmation'), /completed confirmation/);
});
it('rehashing a run cannot change its approved provider controls', async () => {
  const { runIdOf } = await import('../../benchmark/lib/locomo-policy.ts');
  const report = JSON.parse(await readFile('benchmark/results/locomo-policy.json', 'utf8')) as LocomoPolicy;
  // Changing every row equally bypasses pairwise comparability, but not the approved host.
  for (const attempt of report.attempts.filter(a => a.run.tier === 'live')) {
    attempt.run.deadlineMs = 1;
    attempt.runId = await runIdOf(attempt.cellId, attempt.run);
  }
  report.reportId = await reportIdOf(report);
  await assert.rejects(verifyPolicyReport(report), /approved controls/);
});
it('a changed dataset is refused even when its schema and size are unchanged', async () => {
  const report = await fixture();
  verifyPolicyDataset(report, report.dataset);
  assert.throws(() => verifyPolicyDataset(report, { ...report.dataset, sha256: 'a'.repeat(64) }), /dataset digest/);
});
it('reserves every physical request before concurrency and counts failed requests across runs', async () => {
  let requests = 0, saved = 0;
  const fetch: typeof globalThis.fetch = async () => { requests++; throw new Error('offline'); };
  const journal = { inference: 'a', source: 'b', ceiling: 3, requests: [], cacheWrites: {} };
  const guard = createPurchaseGuard({ journal, limit: 2, fetch, save: () => { saved++; }, deadlineMs: 1000 });
  await Promise.allSettled(Array.from({ length: 5 }, () => guard.fetch('https://example.test/v1/chat/completions')));
  assert.equal(requests, 2); assert.equal(journal.requests.length, 2); assert.ok(saved >= 2);
  const next = createPurchaseGuard({ journal, limit: 2, fetch, save() {}, deadlineMs: 1000 });
  await Promise.allSettled([next.fetch('https://example.test/v1/embeddings'), next.fetch('https://example.test/v1/embeddings')]);
  assert.equal(requests, 3); assert.equal(journal.requests.length, 3);
});
it('verifies content identities, not just hexadecimal hash shapes', async () => {
  const report = await fixture(); await verifyPolicyReport(report);
  report.registration.cells[0].retrieval.k++;
  report.reportId = await reportIdOf(report);
  await assert.rejects(verifyPolicyReport(report), /cell|identity/);
});
it('selection cannot spend before a census and confirmation needs a frozen challenger', async () => {
  const report = await fixture();
  assert.throws(() => validatePhase(report, 'selection'), /census/);
  assert.throws(() => validatePhase(report, 'confirmation'), /census|challenger/);
});
it('a paired comparison refuses endpoint and response-control changes', async () => {
  const report = await fixture(), control = report.attempts[0], treatment = structuredClone(control);
  treatment.run.endpoint = 'https://different.test';
  const comparison = comparisonOf(treatment, control, POLICY_OBJECTIVE, 'locomo-f1');
  assert.equal(comparison.eligible, false);
});

it('live phase records observed width and the whole planned question identity, including failed answers', async () => {
  const { loadLocomo } = await import('../../benchmark/lib/locomo.ts');
  const { runLivePhase, RESPONSE_SCHEMA_REVISION } = await import('../../benchmark/lib/locomo-policy.ts');
  const { scriptedEnv, scriptedFetch, liveClients } = await import('../fixtures/scripted-wire.ts');
  const dataset = await loadLocomo(); assert.ok(dataset.available && dataset.valid);
  const report = await fixture();
  const env = scriptedEnv(), wire = scriptedFetch({ fail: 400 });
  const cells = [report.registration.cells.find(c => c.role === 'inert')!];
  const controls = { provider: env.provider, endpoint: 'https://openrouter.ai/api/v1', answerModel: env.model, judgeModel: env.modelStrong,
    embedder: { model: env.embedModel, dims: 0 }, thinking: 'default' as const, responseSchema: RESPONSE_SCHEMA_REVISION,
    retry: { attempts: 1, baseMs: 3000, maxMs: 60000 }, deadlineMs: 120000, concurrency: env.maxConcurrency,
    perRunCeiling: env.maxCalls, campaignCeiling: 900, keySource: env.keySource };
  const input = { dataset, phase: 'selection' as const, cells, conversations: ['conv-30'], perCategory: 1, adversarial: 1,
    controls, source: report.source.sha256, env };
  const failed = await runLivePhase({ ...input, ...liveClients(env, wire.fetch) });
  const good = scriptedFetch();
  const complete = await runLivePhase({ ...input, ...liveClients(env, good.fetch) });
  assert.equal(failed.attempts[0].run.embedder.dims, 8);
  assert.equal(failed.attempts[0].runId, complete.attempts[0].runId);
  assert.equal(failed.attempts[0].run.sampleIds.length, 3);
  assert.equal(failed.attempts[0].denominators.answered, 0);
  assert.equal(failed.attempts[0].eligibility.eligible, false);
  assert.equal(complete.attempts[0].denominators.answered, 3);
  assert.equal(complete.attempts[0].eligibility.eligible, true);
  assert.equal(complete.live.configIdentities.rows[0].identityStatus, 'run');
  const { mergeAttempt, withPrompts, approvedInference, registrationIdOf } = await import('../../benchmark/lib/locomo-policy.ts');
  const { createReportValidator, describeErrors } = await import('../../benchmark/lib/validate.ts');
  const schema = JSON.parse(await readFile('benchmark/schemas/locomo-policy.schema.json', 'utf8'));
  const identitySchema = JSON.parse(await readFile('packages/config/schemas/run-identity.schema.json', 'utf8'));
  for (const attempt of [failed.attempts[0], ...withPrompts(complete.attempts, cells[0].cellId)]) {
    const merged = mergeAttempt(report, attempt);
    merged.registration = { ...merged.registration, inference: await approvedInference(controls) };
    merged.registration.registrationId = await registrationIdOf(merged.registration);
    merged.reportId = await reportIdOf(merged);
    const validated = createReportValidator(schema, [identitySchema])(merged);
    assert.ok(validated.valid, describeErrors(validated).join('\n'));
  }
});

it('a successful recorded replay cannot disappear or change', async () => {
  const entries = new Map<string, unknown>();
  const journal = { inference: 'a', source: 'b', ceiling: 3, requests: [], cacheWrites: {} };
  const guard = createPurchaseGuard({ journal, limit: 2, fetch: globalThis.fetch, save() {}, deadlineMs: 1000 });
  const cache = guard.cache({ get: key => entries.get(key), set: (key, value) => { entries.set(key, value); } });
  await cache.set('same-request', { answer: 'first' });
  await assert.rejects(async () => cache.set('same-request', { answer: 'second' }), /immutable/);
  entries.clear();
  await assert.rejects(async () => cache.get('same-request'), /missing or changed/);
});

it('new registration identities bind dataset bytes while preserving historical registrations', async () => {
  const { buildRegistration } = await import('../../benchmark/lib/locomo-policy.ts');
  const first = await buildRegistration(['conv-1', 'conv-2'], ['conv-2'], 17753, null, 'a'.repeat(64));
  const second = await buildRegistration(['conv-1', 'conv-2'], ['conv-2'], 17753, null, 'b'.repeat(64));
  assert.notEqual(first.registrationId, second.registrationId);
  await verifyPolicyReport(await fixture());
});
