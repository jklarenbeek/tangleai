import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { chatResponse } from '../fixtures/temporal-provider.ts';
import { planTemporalPurchases, temporalPurchaseTransport, type TemporalModels, type TemporalPurchaseJournal } from '../../benchmark/lib/temporal-live.ts';
import { executeLongMemEvalQa } from '../../benchmark/lib/longmemeval-qa.ts';
const model = { endpoint: 'https://scripted.invalid/v1/chat/completions', model: 'scripted', inputUsdPerMillion: 0, outputUsdPerMillion: 0, metadataIdentity: 'scripted-v1' };
const models: TemporalModels = { extract: model, resolve: model, answer: model, judge: model };
test('full scripted QA uses both profiles, keeps gold evaluator-only and replays every physical request with transport disabled', async () => {
  const raw = lmeFixture(), plan = await planTemporalPurchases([raw], [], 'a'.repeat(64), models);
  const journal: TemporalPurchaseJournal = { planHash: plan.sha256, origin: 'scripted', campaignRequests: 100, campaignUsd: 0, entries: [] };
  const approval = { planHash: plan.sha256, runId: 'first', perRunRequests: 100, campaignRequests: 100, campaignUsd: 0 };
  let calls = 0, judges = 0, preparations = 0, resolutions = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)), messages = body.messages as { role: string; content: string }[];
    const content = messages.map(m => m.content).join('\n');
    if (body.max_tokens === 10) { judges++; assert.ok(content.includes('PRIVILEGED_GOLD')); return chatResponse('yes'); }
    assert.ok(!content.includes('PRIVILEGED_GOLD')); assert.ok(!content.includes('has_answer')); assert.ok(!content.includes('answer_repeated'));
    if (content.includes('Extract only evidenced')) {
      preparations++; const sources = JSON.parse(messages.find(m => m.role === 'user')!.content).sources as { id: string; observedAt: { at: string } }[];
      if (preparations === 2) assert.ok(sources.every(s => s.observedAt.at <= '2024-03-01T12:00:00.000Z'));
      return chatResponse({ coveredSourceIds: sources.map(s => s.id), claims: [] });
    }
    if (content.includes('Propose the temporal operation')) {
      resolutions++; return chatResponse({ subject: null, series: null, operation: { kind: 'none' }, citations: [{ start: 0, end: 4, quote: 'When' }] });
    }
    return chatResponse({ answer: 'Insufficient evidence.', citations: [] });
  };
  const first = await executeLongMemEvalQa([raw], plan, temporalPurchaseTransport(plan, journal, approval, { fetch: fetcher, save() {} }));
  assert.equal(first.rows.length, 16); assert.equal(first.rows.filter(r => r.status === 'measured').length, 14); assert.equal(first.rows.filter(r => r.status === 'unmeasured').length, 2);
  assert.equal(first.rows.filter(r => r.fallback === 'ordinary-query').length, 6);
  assert.equal(preparations, 2); assert.equal(resolutions, 2); assert.equal(judges, 14); assert.equal(calls, 32);
  const replay = await executeLongMemEvalQa([raw], plan, temporalPurchaseTransport(plan, journal, approval, { replay: true, save() {}, fetch: async () => { throw Error('network forbidden'); } }));
  assert.deepEqual(replay.rows, first.rows); assert.deepEqual(replay.scores, first.scores); assert.equal(replay.transport.physicalRequests, 0); assert.equal(replay.transport.replayHits, 32);
  assert.equal(journal.origin, 'scripted');
});
