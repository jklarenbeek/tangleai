import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb } from '@tangleai/store';
import { createMemoryForecastStore, createForecastHandlers, forecastMust, forecastQuery, FORECAST_TABLES } from '@tangleai/forecast';
import { fixtureForecastHost, manualForecastSegments } from '../../benchmark/lib/forecast-host-fixture.ts';

for (const memory of [true,false]) it('duplicate delivery produces no extra run, checkpoint, note, model call or spend (' + (memory ? 'memory' : 'SQLite') + ')',async () => {
  const db = await openTangleDb({ jobs: { now: () => 1_000_000,random: () => .5 } });
  try {
    const instant = () => '2025-01-10T00:00:00.000Z', f = await fixtureForecastHost({ db,instant,...(memory ? { forecastStore: createMemoryForecastStore() } : {}) });
    const tick = await f.host.tick(instant());
    assert.equal(tick.started,1); assert.deepEqual(tick.refused,[]);
    const cp = forecastMust(await forecastQuery(f.store,'checkpoints'))[0]; assert.equal(cp.status,'finalized');
    assert.equal(cp.inputHarnessVersionId,f.harness.id); assert.equal(cp.inputHarnessDigest,f.harness.digest);
    const before = await Promise.all(FORECAST_TABLES.map(t => forecastQuery(f.store,t))), calls = f.counters.reduce((n,c) => n + c.calls(),0);
    const duplicate = await f.host.deliver(f.question.id,1);
    assert.equal(duplicate.kind,'duplicate'); if (duplicate.kind === 'duplicate') assert.equal(duplicate.cause.code,'TMAS2001');
    const second = await f.host.tick(instant()); assert.equal(second.started,0); assert.equal(second.due,0);
    assert.deepEqual(await Promise.all(FORECAST_TABLES.map(t => forecastQuery(f.store,t))),before);
    assert.equal(f.counters.reduce((n,c) => n + c.calls(),0),calls); assert.equal(calls,4);
    const trace = await f.masStore.readTrace(tick.deliveries[0].runId!); assert.equal(trace?.run.status,'completed');
    assert.ok(trace!.attempts.some(a => a.invocationId === 'revision-skip')); assert.ok(!trace!.attempts.some(a => a.invocationId === 'revision-run'));
  } finally { await db.close(); }
});
it('a different input under the same run id is refused as TFCT1010 before spend',async () => {
  const db = await openTangleDb({ jobs: {} });
  try {
    const instant = () => '2025-01-10T00:00:00.000Z', first = await fixtureForecastHost({ db,instant });
    const started = await first.host.deliver(first.question.id,1); assert.equal(started.kind,'started');
    const changed = await fixtureForecastHost({ db,instant,policy: { ...first.policy,budget: { turns: 1,ms: 1000 } } });
    const result = await changed.host.deliver(first.question.id,1); assert.equal(result.kind,'refused');
    if (result.kind === 'refused') { assert.equal(result.issues[0].code,'TFCT1010'); assert.equal(result.cause,started.runId); }
    assert.equal(changed.counters.length,0); assert.equal(first.counters.length,0);
  } finally { await db.close(); }
});
it('counts duplicate due deliveries before a worker has claimed the run',async () => {
  const db = await openTangleDb({ jobs: {} });
  try {
    const instant = () => '2025-01-10T00:00:00.000Z';
    const f = await fixtureForecastHost({ db,instant,segments: store => ({ ...manualForecastSegments(db,store),drain: async () => {} }) });
    assert.equal((await f.host.tick(instant())).started,1);
    const repeated = await f.host.tick(instant());
    assert.equal(repeated.started,0); assert.equal(repeated.duplicateDeliveries,1); assert.equal(repeated.refused.length,0);
    assert.equal(repeated.deliveries[0].kind,'duplicate'); assert.equal(f.counters.length,0);
    assert.equal(forecastMust(await forecastQuery(f.store,'checkpoints')).length,1);
  } finally { await db.close(); }
});
it('an out-of-order ordinal fails before any spend or MAS admission',async () => {
  const db = await openTangleDb({ jobs: {} });
  try {
    const f = await fixtureForecastHost({ db,instant: () => '2025-01-25T00:00:00.000Z' });
    const result = await f.host.deliver(f.question.id,2); assert.equal(result.kind,'refused');
    if (result.kind === 'refused') assert.equal(result.issues[0].code,'TFCT1004');
    assert.equal(f.counters.length,0); assert.deepEqual(forecastMust(await forecastQuery(f.store,'checkpoints')),[]);
    assert.equal(await f.masStore.getRun(result.runId!),undefined);
  } finally { await db.close(); }
});
it('reports a failed MAS task in the tick census',async () => {
  const db = await openTangleDb({ jobs: {} });
  try {
    const instant = () => '2025-01-10T00:00:00.000Z';
    const f = await fixtureForecastHost({ db,instant,executor: () => { throw Error('The injected execution binding is unavailable.'); } });
    const tick = await f.host.tick(instant());
    assert.equal(tick.started,1); assert.equal(tick.failed.length,1); assert.equal(tick.failed[0].failure?.error.code,'TMAS2004');
    assert.equal(f.counters.length,0);
  } finally { await db.close(); }
});
it('requires a running MAS attempt before constructing a purchasing client',async () => {
  const db = await openTangleDb({ jobs: {} });
  try {
    const now = () => '2025-01-10T00:00:00.000Z', f = await fixtureForecastHost({ db,instant: now });
    const delivered = await f.host.deliver(f.question.id,1), run = await f.masStore.getRun(delivered.runId!); let constructions = 0;
    const handlers = createForecastHandlers({ forecastStore: f.store,masStore: f.masStore,executableRevision: f.host.plan.executableRevision,now,clock: () => 0,executor: () => { constructions++; throw Error('No active attempt.'); },noteBuilder: () => { constructions++; throw Error('No active attempt.'); } });
    await assert.rejects(async () => handlers['checkpoint-run']({ value: run!.input as Record<string,unknown>,state: {},node: 'checkpoint-run',path: 'checkpoint-run',idempotencyKey: delivered.runId + '/root//0/checkpoint-run',signal: new AbortController().signal }),e => (e as { code: string }).code === 'TFCT1004');
    assert.equal(constructions,0);
  } finally { await db.close(); }
});
