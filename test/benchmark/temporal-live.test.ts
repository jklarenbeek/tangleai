import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { planTemporalPurchases, temporalPurchaseTransport, type TemporalModels, type TemporalPurchaseJournal } from '../../benchmark/lib/temporal-live.ts';
const model = { endpoint: 'https://scripted.invalid/v1/chat/completions', model: 'scripted', inputUsdPerMillion: 1, outputUsdPerMillion: 2, metadataIdentity: 'fixture-prices' };
const models: TemporalModels = { extract: model, resolve: model, answer: model, judge: model };
async function fixture() {
  const plan = await planTemporalPurchases([lmeFixture()], [], 'a'.repeat(64), models);
  const journal: TemporalPurchaseJournal = { planHash: plan.sha256, origin: 'scripted', campaignRequests: 2, campaignUsd: 1, entries: [] };
  const approval = { planHash: plan.sha256, runId: 'first', perRunRequests: 1, campaignRequests: 2, campaignUsd: 1 };
  const request = { method: 'POST', body: JSON.stringify({ model: 'scripted', messages: [{ role: 'user', content: 'source' }], max_tokens: 1 }) };
  return { plan, journal, approval, request };
}
test('dry plan enumerates both profiles, independent source chunks, rows and bounded repairs without credentials', async () => {
  const { plan } = await fixture(); assert.equal(plan.profileCases, 2);
  assert.equal(plan.sourceOccurrences, 5); assert.equal(plan.embedding.physicalBatches, 0); assert.equal(plan.embedding.logicalItems, 7);
  assert.equal(plan.byRole.extract.baseRequests, 2); assert.equal(plan.byRole.extract.repairRequests, 2);
  assert.equal(plan.byRole.answer.baseRequests, 14); assert.equal(plan.byRole.judge.physicalRequests, 14);
  assert.equal(plan.worstCaseRequests, 50); assert.ok(plan.worstCaseUsd! > 0);
  assert.deepEqual(plan, await planTemporalPurchases([lmeFixture()], [], 'a'.repeat(64), models));
  const unconfigured = await planTemporalPurchases([lmeFixture()], [], 'a'.repeat(64)); assert.equal(unconfigured.worstCaseUsd, null); assert.equal(unconfigured.eligibleForApproval, false);
});
test('the approved plan binds exact question text and observation dates, including equal-byte replacements', async () => {
  const raw = lmeFixture(), original = await planTemporalPurchases([raw], [], 'a'.repeat(64), models);
  const question = lmeFixture({ question: raw.question.replace('When', 'What') });
  assert.notEqual((await planTemporalPurchases([question], [], 'a'.repeat(64), models)).sha256, original.sha256);
  const dated = lmeFixture(); dated.haystack_dates[1] = '2024/02/28 (Wed) 12:00';
  assert.notEqual((await planTemporalPurchases([dated], [], 'a'.repeat(64), models)).sha256, original.sha256);
});
test('per-run, campaign and zero budgets reserve before the transport and survive resumed runs', async () => {
  const { plan, journal, approval, request } = await fixture(); let calls = 0, saves = 0;
  const options = { save: () => { saves++; }, fetch: (async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); assert.equal(journal.entries.at(-1)!.phase, 'in-flight'); return new Response('reply'); }) as typeof fetch };
  const zero = temporalPurchaseTransport(plan, journal, { ...approval, perRunRequests: 0 }, options);
  await assert.rejects(() => zero.forJob(plan.jobs[0].id)(model.endpoint, request), /budget/); assert.equal(calls, 0); assert.equal(saves, 0);
  const first = temporalPurchaseTransport(plan, journal, approval, options);
  await first.forJob(plan.jobs[0].id)(model.endpoint, request);
  await assert.rejects(() => first.forJob(plan.jobs[1].id)(model.endpoint, request), /budget/); assert.equal(calls, 1);
  const resumed = temporalPurchaseTransport(plan, journal, approval, options);
  await assert.rejects(() => resumed.forJob(plan.jobs[1].id)(model.endpoint, request), /budget/);
  const second = temporalPurchaseTransport(plan, journal, { ...approval, runId: 'second' }, options);
  await second.forJob(plan.jobs[1].id)(model.endpoint, request); assert.equal(calls, 2);
  const third = temporalPurchaseTransport(plan, journal, { ...approval, runId: 'third' }, options);
  await assert.rejects(() => third.forJob(plan.jobs[2].id)(model.endpoint, request), /budget/); assert.equal(calls, 2); assert.equal(saves, 4);
});
test('HTTP failures replay without network; modified bodies, models, receipts and plans are refused', async () => {
  const { plan, journal, approval, request } = await fixture(); let calls = 0;
  const transport = temporalPurchaseTransport(plan, journal, approval, { save() {}, fetch: (async () => { calls++; return new Response('rate limited', { status: 429 }); }) as typeof fetch });
  assert.equal((await transport.forJob(plan.jobs[0].id)(model.endpoint, request)).status, 429);
  const replay = temporalPurchaseTransport(plan, journal, approval, { replay: true, save() {}, fetch: async () => { throw Error('network forbidden'); } });
  assert.equal(await (await replay.forJob(plan.jobs[0].id)(model.endpoint, request)).text(), 'rate limited'); assert.equal(calls, 1); assert.equal(replay.stats().physicalRequests, 0);
  await assert.rejects(() => replay.forJob(plan.jobs[1].id)(model.endpoint, request), /missing receipt/);
  await assert.rejects(() => replay.forJob(plan.jobs[0].id)(model.endpoint, { ...request, body: request.body.replace('source', 'other') }), /request changed/);
  await assert.rejects(() => replay.forJob(plan.jobs[0].id)(model.endpoint, { ...request, body: request.body.replace('scripted', 'another') }), /model changed/);
  journal.entries[0].reply = 'forged'; assert.throws(() => temporalPurchaseTransport(plan, journal, approval, { save() {}, fetch }), /receipt changed/);
  assert.throws(() => temporalPurchaseTransport({ ...plan, sourceIdentity: 'changed' }, journal, approval, { save() {}, fetch }), /plan changed/);
});
test('lost responses consume budget and cannot be repurchased; uncooperative fetches obey the physical deadline', async () => {
  const { plan, journal, approval, request } = await fixture(); let calls = 0;
  const transport = temporalPurchaseTransport(plan, journal, approval, { deadlineMs: 10, save() {}, fetch: async () => { calls++; return new Promise<Response>(() => {}); } });
  await assert.rejects(() => transport.forJob(plan.jobs[0].id)(model.endpoint, request), /deadline/);
  assert.equal(journal.entries[0].phase, 'unknown'); assert.equal(calls, 1);
  await assert.rejects(() => transport.forJob(plan.jobs[0].id)(model.endpoint, request), /uncertain/); assert.equal(calls, 1);
});
test('absolute dollars and payload ceilings refuse before any physical purchase', async () => {
  const { plan, journal, approval, request } = await fixture(); journal.campaignUsd = 0;
  const transport = temporalPurchaseTransport(plan, journal, { ...approval, campaignUsd: 0 }, { save() {}, fetch: async () => { throw Error('forbidden'); } });
  await assert.rejects(() => transport.forJob(plan.jobs[0].id)(model.endpoint, request), /dollar budget/);
  await assert.rejects(() => transport.forJob(plan.jobs[0].id)(model.endpoint, { ...request, body: JSON.stringify({ model: 'scripted', max_tokens: 100000 }) }), /output ceiling/);
  await assert.rejects(() => transport.forJob(plan.jobs[0].id)(model.endpoint, { ...request, body: JSON.stringify({ model: 'scripted', max_tokens: 1, input: 'x'.repeat(plan.limits.inputBytes + 1) }) }), /input ceiling/);
  assert.equal(journal.entries.length, 0);
});
test('a provider token-ceiling violation is retained, blocks further purchases and refuses on replay', async () => {
  const { plan, journal, approval, request } = await fixture(); let calls = 0;
  const transport = temporalPurchaseTransport(plan, journal, approval, { save() {}, fetch: async () => { calls++; return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:100000}})); } });
  await assert.rejects(()=>transport.forJob(plan.jobs[0].id)(model.endpoint,request),/provider exceeded/);
  assert.equal(journal.entries[0].phase,'failed');assert.ok(transport.stats().reportedUsd!>0);
  await assert.rejects(()=>transport.forJob(plan.jobs[0].id)(model.endpoint,request),/provider exceeded/);
  await assert.rejects(()=>transport.forJob(plan.jobs[1].id)(model.endpoint,request),/provider exceeded/);assert.equal(calls,1);
});
