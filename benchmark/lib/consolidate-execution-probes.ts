/** Independent staged-callback and restart assertions over each real backend. */
import assert from 'node:assert/strict';
import { createConsolidationExecutor, createConsolidationSource, type ConsolidationStore,
  type ConsolidationRunRequest, type ConsolidationExecutionResult } from '@tangleai/memory/consolidation';
import { consolidationMust as must, type ConsolidationProbeHost } from './consolidate-store-probes.ts';
export async function runConsolidationExecutionProbes(create: () => Promise<ConsolidationProbeHost>) {
  const rows: { name: string; initial: string; initialCalls: number; resumedCalls: number; retainedSources: number; finalArtifacts: number }[] = [];
  async function fixture() {
    const host = await create();
    const sources = await Promise.all(['Sam moved to Paris in May.', 'Alex visited Sam in June.'].map(async (text, sequence) =>
      must(await createConsolidationSource({ scope: 'staged', key: `${sequence}`, sequence, snapshot: { id: `${sequence}`, text,
        evidence: `session/${sequence}`, at: '2024-06-01T00:00:00Z', tags: [], kind: 'event' } }))));
    must(await host.store.enqueue(sources, { maxPending: 2 }));
    const request: ConsolidationRunRequest = { scope: 'staged', key: 'pass', expectedGeneration: 0, sourceIds: sources.map(source => source.id), completedAt: 1000 };
    const synthesis = { status: 'ok', claims: [{ text: 'Alex visited Sam after Sam moved to Paris.', sourceIds: request.sourceIds }] };
    const support = { status: 'ok', supported: [true] }, embedding = { model: 'scripted-fresh', dims: 2, vectors: [[0, 1]] };
    const counts = { synthesis: 0, support: 0, embedding: 0 };
    const seams = {
      synthesizer: { id: 'scripted-relation/1', async run() { counts.synthesis++; return synthesis; } },
      verifier: { id: 'scripted-support/1', async run() { counts.support++; return support; } },
      embedder: { model: 'scripted-fresh', dims: 2, async embed() { counts.embedding++; return embedding; } },
    };
    return { host, sources, request, synthesis, support, embedding, counts, seams };
  }
  async function check(name: string, task: (f: Awaited<ReturnType<typeof fixture>>) => Promise<{ initial: ConsolidationExecutionResult; resumed: ConsolidationExecutionResult }>) {
    const f = await fixture();
    try {
      const { initial, resumed } = await task(f);
      assert.equal(resumed.status, 'success', name);
      assert.deepEqual(f.counts, { synthesis: 1, support: 1, embedding: 1 }, name);
      const state = must(await f.host.store.snapshot(f.request.scope));
      assert.equal(state.sources.length, 2); assert.equal(state.artifacts.length, 1); assert.equal(state.buffer.pending.length, 0);
      assert.deepEqual(state.artifacts[0].sourceIds, f.request.sourceIds); assert.deepEqual(state.artifacts[0].embedding, [0, 1]);
      const replay = await createConsolidationExecutor({ store: f.host.store, ...f.seams }).execute(f.request);
      assert.equal(replay.status, 'success'); assert.equal(replay.accounting.invoked, 0);
      if (replay.status === 'success') assert.equal(replay.value.writes, 0);
      assert.deepEqual(must(await f.host.store.snapshot(f.request.scope)), state);
      for (const result of [initial, resumed, replay]) { const c = result.accounting;
        assert.equal(c.reservedCalls, c.completedCalls + c.refusedCalls + c.failedCalls + c.unknownCalls); }
      rows.push({ name, initial: initial.status === 'success' ? 'success' : initial.reason,
        initialCalls: initial.accounting.invoked, resumedCalls: resumed.accounting.invoked, retainedSources: state.sources.length, finalArtifacts: state.artifacts.length });
    } finally { await f.host.close(); }
  }
  for (const kind of ['synthesis', 'support', 'embedding'] as const) for (const boundary of ['before-dispatch', 'after-result'] as const)
    await check(`${kind}-${boundary}`, async f => {
      const base = f.host.store; let injected = false;
      const store: ConsolidationStore = { ...base, async update(operation, revision) {
        const last = operation.steps.at(-1);
        if (!injected && last?.kind === kind && last.phase === (boundary === 'before-dispatch' ? 'dispatched' : 'completed')) {
          injected = true; f.host.failAt = 'put:operations';
          try { return await base.update(operation, revision); } finally { f.host.failAt = null; }
        }
        return base.update(operation, revision);
      } };
      const initial = await createConsolidationExecutor({ store, ...f.seams }).execute(f.request);
      assert.equal(initial.status, 'refused'); if (initial.status === 'refused') assert.equal(initial.reason, boundary === 'before-dispatch' ? 'persistence' : 'unknown');
      const failed = must(await base.snapshot(f.request.scope)); assert.equal(failed.artifacts.length, 0); assert.equal(failed.buffer.pending.length, 2);
      await f.host.reopen();
      const executor = createConsolidationExecutor({ store: f.host.store, ...f.seams });
      if (boundary === 'after-result') {
        const uncertain = await executor.execute(f.request); assert.equal(uncertain.status, 'refused'); assert.equal(uncertain.accounting.invoked, 0);
        const operation = must(await f.host.store.operation(f.request.scope, f.request.key))!;
        assert.equal((await executor.resolve(f.request, { stopped: true, revision: operation.revision,
          requestHash: operation.steps.at(-1)!.requestHash, result: f[kind] })).status, 'success');
      }
      return { initial, resumed: await executor.execute(f.request) };
    });
  for (const boundary of ['reservation', 'prepared', 'activation'] as const) await check(`persistence-${boundary}`, async f => {
    const base = f.host.store; let injected = false;
    async function fault<T>(task: () => Promise<T>): Promise<T> {
      f.host.failAt = boundary === 'activation' ? 'put:buffers' : 'put:operations';
      try { return await task(); } finally { f.host.failAt = null; }
    }
    const store: ConsolidationStore = { ...base,
      async reserve(input) { if (boundary === 'reservation' && !injected) { injected = true; return fault(() => base.reserve(input)); } return base.reserve(input); },
      async update(operation, revision) { if (boundary === 'prepared' && operation.phase === 'prepared' && !injected) {
        injected = true; return fault(() => base.update(operation, revision)); } return base.update(operation, revision); },
      async apply(input) { if (boundary === 'activation' && !injected) { injected = true; return fault(() => base.apply(input)); } return base.apply(input); },
    };
    const initial = await createConsolidationExecutor({ store, ...f.seams }).execute(f.request);
    assert.equal(initial.status, 'refused'); if (initial.status === 'refused') assert.equal(initial.reason, 'persistence');
    assert.equal(must(await base.snapshot(f.request.scope)).buffer.pending.length, 2);
    await f.host.reopen();
    const resumed = await createConsolidationExecutor({ store: f.host.store, ...f.seams }).execute(f.request);
    assert.equal(resumed.accounting.invoked, boundary === 'reservation' ? 3 : 0);
    return { initial, resumed };
  });
  await check('independent-handles-dispatch-once', async f => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const original = f.seams.synthesizer.run;
    f.seams.synthesizer.run = async () => { entered(); await held; return original(); };
    const first = createConsolidationExecutor({ store: f.host.store, ...f.seams }).execute(f.request);
    await started;
    const contender = await createConsolidationExecutor({ store: f.host.peer, ...f.seams }).execute(f.request);
    assert.equal(contender.status, 'refused'); if (contender.status === 'refused') assert.equal(contender.reason, 'unknown');
    assert.equal(contender.accounting.invoked, 0);
    release(); const initial = await first; assert.equal(initial.status, 'success');
    await f.host.reopen();
    return { initial, resumed: await createConsolidationExecutor({ store: f.host.store, ...f.seams }).execute(f.request) };
  });
  for (const kind of ['refusal', 'unsupported', 'foreign-source', 'output-budget', 'embedding', 'unknown'] as const) {
    const f = await fixture();
    try {
      const seams = { ...f.seams,
        synthesizer: { id: `negative-${kind}`, async run() {
          f.counts.synthesis++;
          if (kind === 'unknown') throw new Error('scripted uncertain external outcome');
          if (kind === 'refusal') return { status: 'refused', detail: 'scripted refusal' };
          if (kind === 'foreign-source') return { status: 'ok', claims: [{ text: 'foreign claim', sourceIds: ['a'.repeat(64)] }] };
          if (kind === 'output-budget') return { status: 'ok', claims: [{ text: 'x'.repeat(9000), sourceIds: f.request.sourceIds }] };
          return f.synthesis;
        } },
        verifier: { id: `support-${kind}`, async run() { f.counts.support++; return { status: 'ok', supported: [kind !== 'unsupported'] }; } },
        embedder: { model: 'scripted-fresh', dims: 2, async embed() { f.counts.embedding++; return kind === 'embedding' ? { ...f.embedding, model: 'wrong-model' } : f.embedding; } },
      };
      const initial = await createConsolidationExecutor({ store: f.host.store, ...seams }).execute(f.request);
      assert.equal(initial.status, 'refused');
      const expected = kind === 'foreign-source' ? 'unsupported' : kind === 'output-budget' ? 'budget' : kind;
      if (initial.status === 'refused') assert.equal(initial.reason, expected);
      const calls = { ...f.counts };
      await f.host.reopen();
      const resumed = await createConsolidationExecutor({ store: f.host.store, ...seams }).execute(f.request);
      assert.equal(resumed.status, 'refused'); assert.equal(resumed.accounting.invoked, 0); assert.deepEqual(f.counts, calls);
      const state = must(await f.host.store.snapshot(f.request.scope));
      assert.equal(state.sources.length, 2); assert.equal(state.buffer.pending.length, 2); assert.equal(state.artifacts.length, 0);
      const c = initial.accounting; assert.equal(c.reservedCalls, c.completedCalls + c.refusedCalls + c.failedCalls + c.unknownCalls);
      rows.push({ name: `negative-${kind}`, initial: expected, initialCalls: initial.accounting.invoked, resumedCalls: 0,
        retainedSources: state.sources.length, finalArtifacts: state.artifacts.length });
    } finally { await f.host.close(); }
  }
  return { rows, passed: rows.length, failed: 0, physicalRequests: 0 };
}
