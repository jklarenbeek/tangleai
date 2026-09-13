import { createConsolidationMemoryStore, createConsolidationSource, planDeterministicConsolidation,
  createConsolidationLexicalIndex, createConsolidationExecutor, createConsolidationRunner, createConsolidationOperations } from '@tangleai/memory/consolidation';
import { validateConsolidationShape } from '@tangleai/core/schemas/consolidation';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const must = result => { if (result.status !== 'success') throw new Error(`${result.reason}: ${result.detail}`); return result.value; };
export async function qualifyConsolidation(store = createConsolidationMemoryStore()) {
  const scope = 'installed-consolidation';
  const snapshot = { id: 'same-content', text: 'Sam meets Alex in Paris.', evidence: 'host transcript', tags: ['travel'], kind: 'event', at: '2023-05-08T13:56:00Z' };
  const sources = [];
  for (let sequence = 0; sequence < 2; sequence++) sources.push(must(await createConsolidationSource({ scope, sequence, key: `turn-${sequence}`, snapshot })));
  ensure(sources[0].id !== sources[1].id, 'equal-text occurrences remain distinct');
  ensure(validateConsolidationShape('consolidationSource', sources[0]).valid, 'public source schema');
  const delivery = must(await store.enqueue(sources, { maxPending: 2 }));
  const duplicate = must(await store.enqueue(sources, { maxPending: 2 }));
  ensure(duplicate.writes === 0 && duplicate.admitted === 0, 'delivery replay changes nothing');
  const plan = must(await planDeterministicConsolidation(sources));
  const recipeHash = plan.recipeHash, artifact = plan.artifacts[0];
  ensure(plan.artifacts.length === 1 && artifact.sourceIds.length === 2, 'pure tier preserves both occurrences');
  ensure(createConsolidationLexicalIndex([{ id: artifact.id, text: artifact.text }]).rank('Paris')[0]?.id === artifact.id, 'installed lexical routing');
  const input = { scope, key: 'installed-pass', expectedGeneration: 0, sourceIds: sources.map(source => source.id), recipeHash, artifacts: [artifact], completedAt: 1000 };
  const first = must(await store.apply(input)), beforeReplay = store.stats().writes;
  const replay = must(await store.apply(input));
  ensure(replay.replayed && replay.writes === 0 && replay.logicalCalls === 0 && replay.embeddingItems === 0, 'activation replay has zero effects');
  ensure(store.stats().writes === beforeReplay, 'replay writes no hidden state');
  const state = must(await store.snapshot(scope));
  ensure(state.sources.length === 2 && state.artifacts.length === 1 && state.buffer.pending.length === 0, 'atomic activation preserves evidence');
  state.sources[0].snapshot.text = 'caller mutation';
  ensure(must(await store.snapshot(scope)).sources[0].snapshot.text === snapshot.text, 'stored evidence is isolated');
  const overflow = await store.enqueue([must(await createConsolidationSource({ scope, sequence: 2, key: 'turn-2', snapshot }))], { maxPending: 0 });
  ensure(overflow.status === 'refused' && overflow.reason === 'capacity', 'invalid bound refuses');
  const semantic = must(await createConsolidationSource({ scope: 'installed-synthesis', key: 'event', sequence: 0, snapshot }));
  must(await store.enqueue([semantic], { maxPending: 1 }));
  let calls = 0;
  const executor = createConsolidationExecutor({ store,
    synthesizer: { id: 'installed-quote/1', async run(request) { calls++; return { status: 'ok', claims: [{ text: request.sources[0].text, sourceIds: [request.sources[0].id] }] }; } },
    verifier: { id: 'installed-support/1', async run(request) { calls++; return { status: 'ok', supported: [request.claims[0].text === request.sources[0].text] }; } },
  });
  const synthesisRequest = { scope: semantic.scope, key: 'supported', expectedGeneration: 0, sourceIds: [semantic.id], completedAt: 1000 };
  const synthesized = await executor.execute(synthesisRequest);
  ensure(synthesized.status === 'success' && validateConsolidationShape('consolidationExecutionResult', synthesized).valid, 'installed supported execution and result schema');
  const synthesizedReplay = await executor.execute(synthesisRequest);
  ensure(synthesizedReplay.status === 'success' && synthesizedReplay.accounting.invoked === 0, 'installed staged replay is zero-call');
  ensure(calls === (delivery.admitted === 0 ? 0 : 2), 'reopen preserves completed callbacks');
  const queuedSource = must(await createConsolidationSource({ scope: 'installed-trigger', key: 'arrival', sequence: 0, snapshot }));
  const runner = createConsolidationRunner({ store, policy: { enabled: true }, now: () => 2000 });
  const operations = createConsolidationOperations(runner);
  try {
    const invalid = await operations.invoke('consolidation.run', { scope: queuedSource.scope, key: 'bad', trigger: 'manual', unexpected: 1 });
    ensure(!invalid.ok && invalid.error.code === 'JC2050', 'installed contract rejects before effects');
    const admitted = await operations.invoke('consolidation.enqueue', { sources: [queuedSource] });
    ensure(admitted.ok && admitted.value.status === 'success', 'installed contract queues exact source');
    const triggered = await operations.invoke('consolidation.run', { scope: queuedSource.scope, key: 'manual', trigger: 'manual' });
    ensure(triggered.ok && triggered.value.status === 'success', 'installed host trigger activates');
    const replayed = await operations.invoke('consolidation.run', { scope: queuedSource.scope, key: 'manual', trigger: 'count' });
    ensure(replayed.ok && replayed.value.status === 'success' && replayed.value.value.writes === 0, 'installed trigger replay is zero-write');
    ensure(must(await store.snapshot(queuedSource.scope)).buffer.completedAt === 2000, 'completion time is durable');
  } finally { await operations.close(); }
  return { sources: 2, artifacts: 1, replayWrites: replay.writes, reopened: delivery.admitted === 0 && first.replayed };
}
