import { createConsolidationMemoryStore, createConsolidationSource, type ConsolidationSource,
  type ConsolidationResult, planDeterministicConsolidation, createConsolidationExecutor, type ConsolidationExecutionResult, createConsolidationRunner, createConsolidationOperations } from '@tangleai/memory/consolidation';
import { createConsolidationDbStore } from '@tangleai/store/consolidation-store';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
const snapshot: MemoryUnit = { id: 'fact', text: 'typed fact', evidence: 'typed source', tags: [], at: '2024-01-01T00:00:00Z', kind: 'fact' };
const source: Promise<ConsolidationResult<ConsolidationSource>> = createConsolidationSource({ scope: 'typed', key: 'one', sequence: 0, snapshot });
const store = createConsolidationMemoryStore();
// @ts-expect-error scope is a string at the public boundary
store.snapshot(42);
void source; void createConsolidationDbStore;

void source.then(async result => { if (result.status === "success") await planDeterministicConsolidation([result.value], { maxArtifactChars: 80 }); });

const executor = createConsolidationExecutor({ store, synthesizer: { id: 'typed', async run(request) {
  return { status: 'ok', claims: request.sources.map(source => ({ text: source.text, sourceIds: [source.id] })) };
} }, verifier: { id: 'typed-support', async run(request) { return { status: 'ok', supported: request.claims.map(() => true) }; } } });
const execution: Promise<ConsolidationExecutionResult> = executor.execute({ scope: 'typed', key: 'pass', sourceIds: ['a'.repeat(64)], expectedGeneration: 0, completedAt: 1 });
void execution;

const runner = createConsolidationRunner({ store, executor, policy: { enabled: true, tier: 'semantic', countThreshold: 2 }, now: () => 1000 });
const triggered: Promise<ConsolidationExecutionResult> = runner.run({ scope: 'typed', key: 'count', trigger: 'count' });
void triggered; void createConsolidationOperations(runner).describe();
// @ts-expect-error trigger kinds are closed
runner.run({ scope: 'typed', key: 'bad', trigger: 'cron' });
