import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationRunner, createConsolidationExecutor, createConsolidationSource,
  createConsolidationMemoryStore } from '@tangleai/memory/consolidation';
import { consolidationMust as must, createConsolidationMemoryProbeHost } from '../../benchmark/lib/consolidate-store-probes.ts';
async function source(key: string) { return must(await createConsolidationSource({ scope: 'triggers', key, sequence: Number(key),
  snapshot: { id: key, text: `Sam visits Paris on day ${key}.`, evidence: `turn/${key}`, at: '2024-01-01T00:00:00Z', kind: 'event', tags: [] } })); }
const reason = (result: { status: string; reason?: string }) => result.status === 'refused' ? result.reason : null;
it('qualifies disabled, empty, count, time, cooldown and clock-skew with persisted timing', async () => {
  const host = await createConsolidationMemoryProbeHost(); let now = 1000;
  const policy = { enabled: true, countThreshold: 2, intervalMs: 100, cooldownMs: 50, maxPending: 4, maxBatchSources: 2 };
  const disabled = createConsolidationRunner({ store: host.store, now: () => now });
  assert.equal(reason(await disabled.run({ scope: 'triggers', key: 'disabled', trigger: 'manual' })), 'disabled');
  assert.equal(host.store.stats().writes, 0); await disabled.close();
  let runner = createConsolidationRunner({ store: host.store, policy, now: () => now });
  try {
    assert.equal(reason(await runner.run({ scope: 'triggers', key: 'empty', trigger: 'manual' })), 'empty');
    must(await runner.enqueue([await source('1')]));
    const before = must(await runner.inspect('triggers')); assert.equal(before.buffer.pendingSince, 1000);
    assert.equal(reason(await runner.run({ scope: 'triggers', key: 'below', trigger: 'count' })), 'below-count');
    now = 1099; assert.equal(reason(await runner.run({ scope: 'triggers', key: 'early', trigger: 'time' })), 'not-due');
    assert.deepEqual(must(await runner.inspect('triggers')), before);
    now = 1100; const timed = must(await runner.run({ scope: 'triggers', key: 'timed', trigger: 'time' })); assert.equal(timed.sourceCount, 1);
    must(await runner.enqueue([await source('2')]));
    now = 1110; assert.equal(reason(await runner.run({ scope: 'triggers', key: 'cool', trigger: 'manual' })), 'cooldown');
    now = 1090; assert.equal(reason(await runner.run({ scope: 'triggers', key: 'skew', trigger: 'manual' })), 'clock-skew');
    now = 1150; must(await runner.run({ scope: 'triggers', key: 'manual', trigger: 'manual' }));
    must(await runner.enqueue([await source('3'), await source('4')]));
    now = 1200; const counted = must(await runner.run({ scope: 'triggers', key: 'counted', trigger: 'count' })); assert.equal(counted.sourceCount, 2);
    await runner.close(); await host.reopen();
    runner = createConsolidationRunner({ store: host.store, policy, now: () => now });
    const state = must(await runner.inspect('triggers'));
    const replay = must(await runner.run({ scope: 'triggers', key: 'timed', trigger: 'time' })); assert.equal(replay.writes, 0); assert.ok(replay.replayed);
    assert.deepEqual(must(await runner.inspect('triggers')), state);
    now = 1199; assert.equal(reason(await runner.run({ scope: 'triggers', key: 'restart-skew', trigger: 'manual' })), 'clock-skew');
  } finally { await runner.close(); await host.close(); }
});
it('reports invalid clocks and budgets without consuming pending evidence', async () => {
  for (const value of [NaN, Infinity, -1]) {
    const store = createConsolidationMemoryStore(); must(await store.enqueue([await source('1')], { maxPending: 1 }));
    const runner = createConsolidationRunner({ store, policy: { enabled: true }, now: () => value });
    try { assert.equal(reason(await runner.run({ scope: 'triggers', key: 'invalid-clock', trigger: 'manual' })), 'clock-skew'); }
    finally { await runner.close(); }
    assert.equal(must(await store.snapshot('triggers')).buffer.pending.length, 1);
  }
  const store = createConsolidationMemoryStore(); must(await store.enqueue([await source('1')], { maxPending: 1 }));
  const runner = createConsolidationRunner({ store, policy: { enabled: true }, deterministic: { maxInputChars: 1 }, now: () => 1000 });
  try { assert.equal(reason(await runner.run({ scope: 'triggers', key: 'budget', trigger: 'manual' })), 'budget'); }
  finally { await runner.close(); }
  assert.equal(must(await store.snapshot('triggers')).buffer.pending.length, 1);
});
it('uses Jaren queue bounds, queued cancellation and drained close', async () => {
  const store = createConsolidationMemoryStore(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const executor = createConsolidationExecutor({ store,
    synthesizer: { id: 'held', async run(request) { entered(); await held; return { status: 'ok', claims: request.sources.map(s => ({ text: s.text, sourceIds: [s.id] })) }; } },
    verifier: { id: 'quotes', async run(request) { return { status: 'ok', supported: request.claims.map(() => true) }; } },
  });
  const runner = createConsolidationRunner({ store, executor, policy: { enabled: true, tier: 'semantic', maxQueue: 1 }, now: () => 1000 });
  must(await runner.enqueue([await source('1')]));
  const request = { scope: 'triggers', key: 'held', trigger: 'manual' as const };
  const first = runner.run(request); await started;
  const controller = new AbortController(); const queued = runner.run(request, { signal: controller.signal });
  assert.equal(reason(await runner.run({ ...request, key: 'overflow' })), 'backpressure');
  controller.abort(); assert.equal(reason(await queued), 'cancelled');
  assert.equal(reason(await runner.run(request, { deadline: 0 })), 'budget');
  const closingQueue = runner.run(request); let closed = false;
  const closing = runner.close().then(() => { closed = true; });
  assert.equal(reason(await closingQueue), 'closed'); assert.equal(closed, false);
  release(); must(await first); await closing;
  assert.equal(reason(await runner.run(request)), 'closed');
  assert.deepEqual(runner.stats(), { active: 0, queued: 0, closed: true });
});
it('anchors cooldown to actual completion after a slow callback', async () => {
  const store = createConsolidationMemoryStore(); let now = 1000;
  const executor = createConsolidationExecutor({ store,
    synthesizer: { id: 'slow-clock', async run(request) { now = 5000; return { status: 'ok', claims: request.sources.map(s => ({ text: s.text, sourceIds: [s.id] })) }; } },
    verifier: { id: 'quotes', async run(request) { return { status: 'ok', supported: request.claims.map(() => true) }; } },
  });
  const runner = createConsolidationRunner({ store, executor, policy: { enabled: true, tier: 'semantic', cooldownMs: 1000 }, now: () => now });
  try {
    must(await runner.enqueue([await source('1')]));
    must(await runner.run({ scope: 'triggers', key: 'slow', trigger: 'manual' }));
    assert.equal(must(await runner.inspect('triggers')).buffer.completedAt, 5000);
    must(await runner.enqueue([await source('2')])); now = 5001;
    assert.equal(reason(await runner.run({ scope: 'triggers', key: 'too-soon', trigger: 'manual' })), 'cooldown');
  } finally { await runner.close(); }
});
it('rejects malformed public operations before effects and exposes declared command/read behavior', async () => {
  const { createConsolidationOperations } = await import('@tangleai/memory/consolidation');
  const store = createConsolidationMemoryStore();
  const runner = createConsolidationRunner({ store, policy: { enabled: true }, now: () => 1000 });
  const operations = createConsolidationOperations(runner);
  try {
    const malformed = await operations.invoke('consolidation.run', { scope: 'triggers', key: 'bad', trigger: 'manual', extra: 1 });
    assert.equal(malformed.ok, false); if (!malformed.ok) assert.equal(malformed.error.code, 'JC2050');
    assert.equal(store.stats().writes, 0);
    assert.deepEqual(operations.describe().operations.map((operation: { id: string; kind: string }) => [operation.id, operation.kind]), [
      ['consolidation.enqueue', 'command'], ['consolidation.inspect', 'read'], ['consolidation.run', 'command'], ['consolidation.resolve', 'command']]);
    const admission = await operations.invoke('consolidation.enqueue', { sources: [await source('1')] });
    assert.equal(admission.ok, true);
    const run = await operations.invoke('consolidation.run', { scope: 'triggers', key: 'public', trigger: 'manual' });
    assert.equal(run.ok, true); if (run.ok) assert.equal((run.value as { status: string }).status, 'success');
    const inspected = await operations.invoke('consolidation.inspect', { scope: 'triggers' });
    assert.equal(inspected.ok, true); assert.equal(must(await store.snapshot('triggers')).buffer.pending.length, 0);
  } finally { await operations.close(); }
});
it('qualifies persisted triggers, no-op effects and public unknown resolution in memory', async () => {
  const { runConsolidationTriggerProbes } = await import('../../benchmark/lib/consolidate-trigger-probes.ts');
  const report = await runConsolidationTriggerProbes(createConsolidationMemoryProbeHost);
  assert.equal(report.passed, 27); assert.equal(report.failed, 0); assert.equal(report.physicalRequests, 0);
});
it('preserves first admission time on replay and refuses activation before that time', async () => {
  const { applyDeterministicConsolidation } = await import('@tangleai/memory/consolidation');
  const store = createConsolidationMemoryStore(), evidence = await source('1');
  must(await store.enqueue([evidence], { maxPending: 1, enqueuedAt: 1000 }));
  const duplicate = must(await store.enqueue([evidence], { maxPending: 1, enqueuedAt: 2000 }));
  assert.equal(duplicate.writes, 0); assert.equal(duplicate.buffer.pendingSince, 1000);
  const before = must(await store.snapshot(evidence.scope));
  const result = await applyDeterministicConsolidation(store, [evidence], { key: 'too-early', expectedGeneration: 0, completedAt: 500 });
  assert.equal(reason(result), 'clock-skew'); assert.deepEqual(must(await store.snapshot(evidence.scope)), before);
});
it('refuses malformed direct queue and resolution requests without effects', async () => {
  const store = createConsolidationMemoryStore(), runner = createConsolidationRunner({ store });
  try {
    assert.equal((await runner.enqueue(null as never)).status, 'refused');
    assert.equal((await runner.resolve(null as never, null as never)).status, 'refused');
    assert.equal(store.stats().writes, 0);
  } finally { await runner.close(); }
});
it('rejects an executor bound to a different store before creating a runner', () => {
  const store = createConsolidationMemoryStore(), other = createConsolidationMemoryStore();
  const executor = createConsolidationExecutor({ store: other,
    synthesizer: { id: 'unused', async run() { throw new Error('must not invoke'); } },
    verifier: { id: 'unused', async run() { throw new Error('must not invoke'); } },
  });
  assert.throws(() => createConsolidationRunner({ store, executor, policy: { enabled: true, tier: 'semantic' } }), /same store/);
  assert.equal(store.stats().writes, 0); assert.equal(other.stats().writes, 0);
});
