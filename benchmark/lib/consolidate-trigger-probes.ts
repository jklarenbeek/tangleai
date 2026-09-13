/** Host-clock and public-operation acceptance over memory and actual SQLite stores. */
import assert from 'node:assert/strict';
import { createConsolidationRunner, createConsolidationExecutor, createConsolidationOperations, createConsolidationSource,
  type ConsolidationResult } from '@tangleai/memory/consolidation';
import { consolidationMust as must, type ConsolidationProbeHost } from './consolidate-store-probes.ts';
export async function runConsolidationTriggerProbes(create: () => Promise<ConsolidationProbeHost>) {
  const host = await create(); let now = 1000, calls = 0;
  const policy = { enabled: true, countThreshold: 2, intervalMs: 100, cooldownMs: 50, maxPending: 4, maxBatchSources: 2 };
  let runner = createConsolidationRunner({ store: host.store, policy, now: () => now });
  const rows: { name: string; outcome: string; writes: number; callbacks: number; pending: number; sources: number }[] = [];
  async function source(key: number) { return must(await createConsolidationSource({ scope: 'trigger-probe', key: `${key}`, sequence: key,
    snapshot: { id: `${key}`, text: `Sam visits Paris on day ${key}.`, evidence: `transcript/${key}`, at: '2024-01-01T00:00:00Z', kind: 'event', tags: [] } })); }
  async function observe(name: string, task: () => Promise<ConsolidationResult<unknown>>, expected: string, zero = false) {
    const before = host.store.stats().writes, priorCalls = calls, result = await task();
    const outcome = result.status === 'success' ? 'success' : result.reason;
    assert.equal(outcome, expected, name);
    const writes = host.store.stats().writes - before, callbacks = calls - priorCalls;
    if (zero) { assert.equal(writes, 0, name); assert.equal(callbacks, 0, name); }
    const state = must(await host.store.snapshot('trigger-probe'));
    rows.push({ name, outcome, writes, callbacks, pending: state.buffer.pending.length, sources: state.sources.length });
  }
  const run = (key: string, trigger: 'manual' | 'count' | 'time') => runner.run({ scope: 'trigger-probe', key, trigger });
  try {
    const disabled = createConsolidationRunner({ store: host.store, now: () => now });
    await observe('disabled', () => disabled.run({ scope: 'trigger-probe', key: 'disabled', trigger: 'manual' }), 'disabled', true); await disabled.close();
    await observe('empty', () => run('empty', 'manual'), 'empty', true);
    must(await runner.enqueue([await source(1)]));
    assert.equal(must(await runner.inspect('trigger-probe')).buffer.pendingSince, 1000);
    await observe('below-count', () => run('below', 'count'), 'below-count', true);
    now = 1099; await observe('not-due', () => run('early', 'time'), 'not-due', true);
    now = 1100; await observe('time', () => run('timed', 'time'), 'success');
    assert.equal(must(await runner.inspect('trigger-probe')).buffer.completedAt, 1100);
    must(await runner.enqueue([await source(2)]));
    now = 1120; await observe('cooldown', () => run('cool', 'manual'), 'cooldown', true);
    now = 1110; await observe('clock-skew', () => run('backwards', 'manual'), 'clock-skew', true);
    now = 1150; await observe('manual', () => run('manual', 'manual'), 'success');
    must(await runner.enqueue([await source(3), await source(4)]));
    now = 1200; await observe('count', () => run('counted', 'count'), 'success');
    now = 1300; must(await runner.enqueue([await source(5)]));
    await runner.close(); await host.reopen(); runner = createConsolidationRunner({ store: host.store, policy, now: () => now });
    now = 1290; await observe('restart-clock-skew', () => run('restart-skew', 'time'), 'clock-skew', true);
    now = 1320; await observe('restart-not-due', () => run('restart-early', 'time'), 'not-due', true);
    now = 1400; await observe('restart-time', () => run('restart-time', 'time'), 'success');
    await observe('completed-replay', () => run('timed', 'time'), 'success', true);
    const overflow = await Promise.all([6, 7, 8, 9, 10].map(source));
    await observe('capacity', () => runner.enqueue(overflow), 'capacity', true);
    now = 1500; must(await runner.enqueue([await source(6)]));
    const bounded = createConsolidationRunner({ store: host.store, policy, deterministic: { maxInputChars: 1 }, now: () => now });
    await observe('budget', () => bounded.run({ scope: 'trigger-probe', key: 'bounded', trigger: 'manual' }), 'budget', true); await bounded.close();
    const executor = createConsolidationExecutor({ store: host.store,
      synthesizer: { id: 'trigger-unknown/1', async run() { calls++; throw new Error('scripted unknown'); } },
      verifier: { id: 'trigger-support/1', async run(request) { calls++; return { status: 'ok', supported: request.claims.map(() => true) }; } },
    });
    const semantic = createConsolidationRunner({ store: host.store, executor, policy: { ...policy, tier: 'semantic' }, now: () => now });
    await observe('unknown', () => semantic.run({ scope: 'trigger-probe', key: 'uncertain', trigger: 'manual' }), 'unknown');
    await observe('unknown-replay', () => semantic.run({ scope: 'trigger-probe', key: 'uncertain', trigger: 'manual' }), 'unknown', true);
    await observe('unknown-new-key', () => semantic.run({ scope: 'trigger-probe', key: 'other', trigger: 'manual' }), 'unknown', true);
    const operations = createConsolidationOperations(semantic);
    const before = host.store.stats().writes;
    const malformed = await operations.invoke('consolidation.run', { scope: 'trigger-probe', key: 'bad', trigger: 'manual', extra: true });
    assert.equal(malformed.ok, false); if (!malformed.ok) assert.equal(malformed.error.code, 'JC2050'); assert.equal(host.store.stats().writes, before);
    const operation = must(await host.store.operation('trigger-probe', 'uncertain'))!;
    await observe('explicit-resolution', async () => {
      const result = await operations.invoke('consolidation.resolve', { request: { scope: 'trigger-probe', key: 'uncertain', sourceIds: operation.sourceIds, expectedGeneration: operation.expectedGeneration, completedAt: 1500 },
        resolution: { stopped: true, revision: operation.revision, requestHash: operation.steps.at(-1)!.requestHash, failure: 'refusal' } });
      assert.equal(result.ok, true); return (result as { ok: true; value: ConsolidationResult<unknown> }).value;
    }, 'success');
    await operations.close();
    await observe('known-failure-fallback', () => run('fallback', 'manual'), 'success');
    await runner.close(); await observe('closed', () => run('closed', 'manual'), 'closed', true);
    now = 1600;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const queuedExecutor = createConsolidationExecutor({ store: host.store,
      synthesizer: { id: 'queued-quotes/1', async run(request) { calls++; entered(); await held;
        return { status: 'ok', claims: request.sources.map(source => ({ text: source.text, sourceIds: [source.id] })) }; } },
      verifier: { id: 'queued-support/1', async run(request) { calls++; return { status: 'ok', supported: request.claims.map(() => true) }; } },
    });
    const queuedRunner = createConsolidationRunner({ store: host.store, executor: queuedExecutor,
      policy: { ...policy, tier: 'semantic', maxQueue: 1 }, now: () => now });
    must(await queuedRunner.enqueue([await source(7)]));
    const initialWrites = host.store.stats().writes, initialCalls = calls;
    const queuedRequest = { scope: 'trigger-probe', key: 'queued-pass', trigger: 'manual' as const };
    const active = queuedRunner.run(queuedRequest); await started;
    const cancellation = new AbortController(), queued = queuedRunner.run(queuedRequest, { signal: cancellation.signal });
    await observe('backpressure', () => queuedRunner.run({ ...queuedRequest, key: 'queue-full' }), 'backpressure', true);
    await observe('queued-cancellation', () => { cancellation.abort(); return queued; }, 'cancelled', true);
    const closingQueued = queuedRunner.run(queuedRequest); let drained = false;
    const closing = queuedRunner.close().then(() => { drained = true; });
    await observe('queued-close', () => closingQueued, 'closed', true); assert.equal(drained, false);
    release(); must(await active); await closing;
    const state = must(await host.store.snapshot('trigger-probe'));
    assert.equal(state.buffer.pending.length, 0); assert.equal(calls - initialCalls, 2);
    rows.push({ name: 'drained-active-pass', outcome: 'success', writes: host.store.stats().writes - initialWrites,
      callbacks: calls - initialCalls, pending: 0, sources: state.sources.length });
    now = 1700;
    const stagedSeams = {
      synthesizer: { id: 'prepared-quotes/1', async run(request: { sources: { id: string; text: string }[] }) { calls++;
        return { status: 'ok', claims: request.sources.map(source => ({ text: source.text, sourceIds: [source.id] })) }; } },
      verifier: { id: 'prepared-support/1', async run(request: { claims: unknown[] }) { calls++; return { status: 'ok', supported: request.claims.map(() => true) }; } },
    };
    const base = host.store; let injected = false;
    const stagedStore = { ...base, async apply(input: Parameters<typeof base.apply>[0]) {
      if (injected) return base.apply(input);
      injected = true; host.failAt = 'put:buffers';
      try { return await base.apply(input); } finally { host.failAt = null; }
    } };
    let stagedRunner = createConsolidationRunner({ store: stagedStore, executor: createConsolidationExecutor({ store: stagedStore, ...stagedSeams }),
      policy: { ...policy, tier: 'semantic' }, now: () => now });
    must(await stagedRunner.enqueue([await source(8)]));
    await observe('prepared-persistence', () => stagedRunner.run({ scope: 'trigger-probe', key: 'prepared', trigger: 'manual' }), 'persistence');
    assert.equal(must(await host.store.operation('trigger-probe', 'prepared'))?.phase, 'prepared');
    await stagedRunner.close(); await host.reopen();
    stagedRunner = createConsolidationRunner({ store: host.store, executor: createConsolidationExecutor({ store: host.store, ...stagedSeams }),
      policy: { ...policy, tier: 'semantic' }, now: () => now });
    const beforeResume = calls;
    await observe('prepared-count-resume', () => stagedRunner.run({ scope: 'trigger-probe', key: 'prepared', trigger: 'count' }), 'success');
    assert.equal(calls, beforeResume); await stagedRunner.close();
    return { rows, passed: rows.length, failed: 0, physicalRequests: 0 };
  } finally { await runner.close(); await host.close(); }
}
