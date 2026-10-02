import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTangleDb, createMasStore, createMasSegmentDriver } from '@tangleai/store';
import { createDecisionRunner, createTradingDecisionHostBindings, tradingDecisionRunId, type TradingDecisionRunnerInput } from '@tangleai/trading';
import { workflowFixture } from './workflow-fixture.ts';
import { checked, attemptProvenance } from '../../benchmark/lib/trading-research-runner.ts';
import { tradingDecisionScript } from '../../benchmark/lib/trading-scripts.ts';
import type { MasChatClient, TraceView } from '@tangleai/mas';

const f = await workflowFixture();
const request = { manifestId: f.manifest.id, asset: f.snapshot.snapshot.asset, sessionId: f.snapshot.snapshot.sessionId, snapshotId: f.snapshot.snapshot.id, portfolioId: f.portfolio.id };
const spendFor: TradingDecisionRunnerInput['spendFor'] = (trace: TraceView) => ({ valid: true, value: {
  calls: trace.attempts.reduce((n, a) => n + a.usage.calls, 0), toolCalls: trace.attempts.reduce((n, a) => n + a.usage.toolCalls, 0),
  tokens: trace.attempts.reduce((n, a) => n + a.usage.promptTokens + a.usage.completionTokens + (a.usage.estimatedTokens ?? 0), 0),
  usd: 0, retries: 0, repairs: trace.attempts.filter(a => a.kind === 'agent' && a.usage.calls === 3).length, ms: trace.run.budget.spent.ms } });
async function setup(path?: string, options: { limits?: TradingDecisionRunnerInput['limits']; invalid?: boolean; census?: { calls: number } } = {}) {
  const db = await openTangleDb({ ...(path ? { path } : {}), jobs: { now: () => 1000000, random: () => 0.5 } });
  const store = createMasStore(db, { now: () => 'scripted-tick' }), census = options.census ?? { calls: 0 }, response = tradingDecisionScript();
  const clientFor = (node: { id: string }): MasChatClient => ({ endpoint: { provider: 'scripted' }, complete: async raw => {
    census.calls++;
    const messages = (raw as { messages: Array<{ role: string; content: unknown }> }).messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
    const output = options.invalid && node.id === 'trader' ? 'invalid json' : await response(node.id, 1, 'completion', messages);
    return { message: { role: 'assistant', content: typeof output === 'string' ? output : JSON.stringify(output) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
  } });
  const runner = createDecisionRunner({ materialized: f.materialized, masStore: store, segments: createMasSegmentDriver(db, store, { owner: 'trading-test', leaseMs: 700000 }),
    limits: options.limits, spendFor, hostFor: async (input, runId) => {
      assert.deepEqual(input, request);
      const bindings = await createTradingDecisionHostBindings({ ...f, providers: f.fixture.providers, materialized: f.materialized,
        trace: async () => { const trace = await store.readTrace(runId); if (!trace) throw Error('Missing native trace'); return trace; }, provenance: attemptProvenance });
      return bindings.valid ? { valid: true, value: { ...bindings.value, contextProviders: {}, clientFor, now: () => 'scripted-tick', clock: () => 1000000 } } : bindings;
    } });
  return { db, store, runner, census };
}
it('a completed native queued decision reopens and replays without another physical request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trading-decision-runner-')), census = { calls: 0 }, path = join(dir, 'run.sqlite');
  try {
    const first = await setup(path, { census });
    const result = checked(await first.runner.run(request, new AbortController().signal));
    assert.equal(result.status, 'completed', JSON.stringify(result.errors)); assert.equal(census.calls, 32); assert.ok(result.output?.admission.intent);
    assert.equal(result.runId, await tradingDecisionRunId(request, f.materialized.workflow.versionId));
    const jobs = await first.db.jobs!.counts(); assert.equal(jobs.done, 1); assert.equal(jobs.pending, 0);
    await first.db.close();
    const second = await setup(path, { census });
    try { assert.deepEqual(checked(await second.runner.run(request, new AbortController().signal)), result); assert.equal(census.calls, 32); }
    finally { await second.db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('a different snapshot cannot reuse an existing decision identity', async () => {
  const host = await setup();
  try {
    checked(await host.runner.run(request, new AbortController().signal));
    const refused = await host.runner.run({ ...request, snapshotId: 'snapshot-other' }, new AbortController().signal);
    assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1006'); assert.equal(host.census.calls, 32);
  } finally { await host.db.close(); }
});
for (const failure of ['budget', 'abort', 'invalid'] as const) it(`native ${failure} failure retains measured spend and no order`, async () => {
  const host = await setup(undefined, { limits: failure === 'budget' ? { calls: 3 } : undefined, invalid: failure === 'invalid' });
  const controller = new AbortController(); if (failure === 'abort') controller.abort();
  try {
    const run = checked(await host.runner.run(request, controller.signal));
    assert.equal(run.status, 'failed'); assert.equal(run.output, null); assert.equal(run.spend.calls, host.census.calls);
    assert.equal(run.errors[0].code, failure === 'budget' ? 'TTRD1009' : 'TTRD1008');
    assert.equal(run.trace.interactions.length, 0); if (failure === 'abort') assert.equal(host.census.calls, 0);
    if (failure === 'invalid') { assert.equal(run.spend.repairs, 1); assert.ok(run.trace.attempts.some(a => a.path === 'trader' && a.status === 'failed')); }
    const before = host.census.calls; assert.deepEqual(checked(await host.runner.run(request, controller.signal)), run); assert.equal(host.census.calls, before);
  } finally { await host.db.close(); }
});
it('run limits cannot widen the materialized cap before a queue write', async () => {
  const host = await setup(undefined, { limits: { calls: f.manifest.limits.calls + 1 } });
  try {
    const result = await host.runner.run(request, new AbortController().signal); assert.equal(result.valid, false);
    assert.equal(host.census.calls, 0); assert.equal((await host.db.jobs!.counts()).done, 0);
  } finally { await host.db.close(); }
});
it('a zero-call ceiling is a retained native budget failure with zero requests', async () => {
  const host = await setup(undefined, { limits: { calls: 0 } });
  try {
    const run = checked(await host.runner.run(request, new AbortController().signal));
    assert.equal(run.status, 'failed'); assert.equal(run.errors[0].code, 'TTRD1009'); assert.equal(run.spend.calls, 0); assert.equal(host.census.calls, 0);
  } finally { await host.db.close(); }
});
