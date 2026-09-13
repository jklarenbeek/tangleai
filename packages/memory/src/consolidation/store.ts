/** Domain checks precede atomic writes; external callbacks never run in a transaction. */
import { cloneJson } from '@jarenjs/core/object';
import { createScheduler } from '@jarenjs/core/schedule';
import { consolidationHash, consolidationSuccess as success, consolidationRefusal as refuse,
  checkConsolidation, sameConsolidationValue as equal, validateConsolidationSource, validateConsolidationArtifact,
  type ConsolidationResult, type ConsolidationBuffer, type ConsolidationOperation,
  type ConsolidationReceipt, type ConsolidationArtifact, type ConsolidationSource } from './contracts.ts';
import { consolidationRowId, type ConsolidationTable, type ConsolidationTables, type ConsolidationTransaction,
  type ConsolidationPersistence, type ConsolidationStore, type ConsolidationApply } from './types.ts';

export const consolidationOperationId = (scope: string, key: string) => consolidationHash(['consolidation-operation', scope, key]);
const emptyBuffer = (scope: string): ConsolidationBuffer => ({ scope, revision: 0, generation: 0, pending: [], completedAt: null });
const validScope = (scope: string) => typeof scope === 'string' && scope.length > 0;
const nonnegative = (value: number) => Number.isSafeInteger(value) && value >= 0;
function immutableOperation(operation: ConsolidationOperation) {
  const { revision: _, phase: __, steps: ___, artifacts: ____, receipt: _____, failure: ______, ...identity } = operation;
  return identity;
}

export function createConsolidationStoreAdapter(persistence: ConsolidationPersistence): ConsolidationStore {
  const stats = { writes: 0, activations: 0, transactions: 0 };
  async function transaction<T>(task: (tx: ConsolidationTransaction) => Promise<ConsolidationResult<T>>,
    activation = false): Promise<ConsolidationResult<T>> {
    try {
      let writes = 0;
      const result = await persistence.transaction(tx => task({
        get: (table, id) => tx.get(table, id), list: (table, scope) => tx.list(table, scope),
        async put(table, row) { await tx.put(table, row); writes++; },
      }));
      stats.transactions++; stats.writes += writes;
      if (activation && result.status === 'success' && writes) stats.activations++;
      return result;
    } catch (cause) { return refuse('persistence', cause instanceof Error ? cause.message : String(cause)); }
  }
  async function verifyReferences(tx: ConsolidationTransaction, scope: string, sourceIds: string[]) {
    for (const id of sourceIds) {
      const source = await tx.get('sources', id);
      if (!source || source.scope !== scope || source.id !== id
        || (await validateConsolidationSource(source)).status !== 'success') return false;
    }
    return true;
  }
  async function overlappingOperation(tx: ConsolidationTransaction, scope: string, sourceIds: string[], ownId: string) {
    const selected = new Set(sourceIds);
    const overlap = (await tx.list('operations', scope)).filter(operation => operation.id !== ownId
      && operation.phase !== 'completed' && operation.phase !== 'failed' && operation.sourceIds.some(id => selected.has(id)));
    if (!overlap.length) return null;
    return overlap.some(operation => operation.steps.some(step => step.phase === 'unknown' || step.phase === 'dispatched'))
      ? refuse('unknown', 'overlapping evidence has an unresolved dispatch')
      : refuse('backpressure', 'overlapping evidence is reserved by another pass');
  }
  const store: ConsolidationStore = {
    stats: () => ({ ...stats }),
    snapshot(scope) {
      if (!validScope(scope)) return Promise.resolve(refuse('invalid-source', 'scope is required'));
      return transaction(async tx => {
        const buffer = await tx.get('buffers', scope) ?? emptyBuffer(scope);
        const sources = await tx.list('sources', scope), artifacts = await tx.list('artifacts', scope), operations = await tx.list('operations', scope);
        const checked = checkConsolidation<ConsolidationBuffer>('consolidationBuffer', buffer, 'invalid-source');
        if (checked.status !== 'success' || buffer.scope !== scope) return refuse('invalid-source', 'persisted buffer is invalid');
        for (const source of sources) {
          const result = await validateConsolidationSource(source);
          if (result.status !== 'success' || source.scope !== scope) return refuse('invalid-source', 'persisted source is invalid');
        }
        if (new Set(sources.map(source => source.key)).size !== sources.length)
          return refuse('invalid-source', 'persisted occurrence keys are not unique');
        const known = new Set(sources.map(source => source.id));
        if (buffer.pending.some(id => !known.has(id))) return refuse('invalid-source', 'pending source is missing');
        for (const artifact of artifacts) {
          const result = await validateConsolidationArtifact(artifact);
          if (result.status !== 'success' || artifact.scope !== scope || artifact.sourceIds.some(id => !known.has(id)))
            return refuse('invalid-artifact', 'persisted artifact or its evidence is invalid');
        }
        for (const operation of operations) {
          if (checkConsolidation('consolidationOperation', operation, 'invalid-operation').status !== 'success'
            || operation.scope !== scope || operation.sourceIds.some(id => !known.has(id))) return refuse('invalid-operation', 'persisted operation is invalid');
        }
        return success(cloneJson({ buffer, sources, artifacts, operations }));
      });
    },
    async enqueue(input, options) {
      if (!Array.isArray(input) || !input.length) return refuse('empty', 'delivery needs source occurrences');
      if (!Number.isSafeInteger(options.maxPending) || options.maxPending < 1) return refuse('capacity', 'maxPending must be a positive integer');
      if (input.length > options.maxPending) return refuse('capacity', 'delivery exceeds pending capacity');
      const sources: ConsolidationSource[] = [];
      for (const row of input) {
        const checked = await validateConsolidationSource(row);
        if (checked.status !== 'success') return checked;
        sources.push(checked.value);
      }
      const scope = sources[0].scope;
      if (sources.some(source => source.scope !== scope)) return refuse('invalid-source', 'one delivery must belong to one scope');
      return transaction(async tx => {
        const buffer = await tx.get('buffers', scope) ?? emptyBuffer(scope);
        const known = await tx.list('sources', scope);
        const keys = new Map(known.map(source => [source.key, source]));
        const added: ConsolidationSource[] = [];
        let replayed = 0;
        for (const source of sources) {
          const old = keys.get(source.key);
          if (old) {
            if (!equal(old, source)) return refuse('identity-conflict', 'an existing occurrence key has a different snapshot or sequence');
            replayed++; continue;
          }
          keys.set(source.key, source); added.push(source);
        }
        if (!added.length) return success({ admitted: 0, replayed, writes: 0, buffer: cloneJson(buffer) });
        if (buffer.pending.length + added.length > options.maxPending) return refuse('capacity', 'pending capacity refuses the whole delivery');
        if (!nonnegative(buffer.revision + 1)) return refuse('budget', 'buffer revision exhausted');
        const next = { ...buffer, revision: buffer.revision + 1, pending: [...buffer.pending, ...added.map(source => source.id)] };
        for (const source of added) await tx.put('sources', source);
        await tx.put('buffers', next);
        return success({ admitted: added.length, replayed, writes: added.length + 1, buffer: cloneJson(next) });
      });
    },
    async apply(input: ConsolidationApply) {
      const { scope, key, expectedGeneration, recipeHash, completedAt } = input;
      if (!validScope(scope) || !validScope(key) || !nonnegative(expectedGeneration) || !nonnegative(completedAt))
        return refuse('invalid-artifact', 'activation needs scope, key, generation and completion time');
      if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || new Set(input.sourceIds).size !== input.sourceIds.length)
        return refuse('invalid-source', 'activation needs unique contributing sources');
      const sourceIds = [...input.sourceIds], selected = new Set(sourceIds);
      if (!Array.isArray(input.artifacts) || !input.artifacts.length) return refuse('invalid-artifact', 'activation needs artifacts');
      const artifacts: ConsolidationArtifact[] = [];
      for (const row of input.artifacts) {
        const checked = await validateConsolidationArtifact(row); if (checked.status !== 'success') return checked;
        const artifact = checked.value;
        if (artifact.scope !== scope || artifact.recipeHash !== recipeHash || artifact.sourceIds.some(id => !selected.has(id)))
          return refuse('invalid-artifact', 'artifact scope, recipe or source membership differs');
        artifacts.push(artifact);
      }
      if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length
        || new Set(artifacts.flatMap(artifact => artifact.sourceIds)).size !== selected.size)
        return refuse('invalid-artifact', 'unique artifacts must cover every selected source');
      const id = await consolidationOperationId(scope, key);
      const requestHash = input.operation?.requestHash ?? await consolidationHash({ scope, key, expectedGeneration, sourceIds, recipeHash, artifacts });
      return transaction(async tx => {
        const prior = await tx.get('operations', id);
        if (prior) {
          if (prior.requestHash !== requestHash || !equal(prior.sourceIds, sourceIds) || prior.recipeHash !== recipeHash
            || prior.expectedGeneration !== expectedGeneration) return refuse('identity-conflict', 'activation key names different inputs');
          if (prior.phase === 'completed') {
            if (!prior.receipt || !equal(prior.artifacts, artifacts)) return refuse('identity-conflict', 'completed activation content differs');
            return success({ ...cloneJson(prior.receipt), replayed: true, writes: 0, logicalCalls: 0, embeddingItems: 0 });
          }
          if (!input.operation || prior.revision !== input.operation.revision || prior.phase !== 'prepared'
            || !equal(prior.artifacts, artifacts) || prior.steps.some(step => step.phase !== 'completed'))
            return refuse('invalid-operation', 'activation requires the exact completely prepared operation');
        } else if (input.operation) return refuse('invalid-operation', 'prepared operation is missing');
        const overlap = await overlappingOperation(tx, scope, sourceIds, id);
        if (overlap) return overlap;
        const buffer = await tx.get('buffers', scope) ?? emptyBuffer(scope);
        if (buffer.generation !== expectedGeneration) return refuse('stale-generation', 'an intervening activation changed the generation');
        if (buffer.completedAt !== null && completedAt < buffer.completedAt) return refuse('clock-skew', 'completion time precedes the previous activation');
        if (sourceIds.some(id => !buffer.pending.includes(id)) || !await verifyReferences(tx, scope, sourceIds))
          return refuse('invalid-source', 'selected evidence is not pending in this scope');
        const added: ConsolidationArtifact[] = [];
        for (const artifact of artifacts) {
          const old = await tx.get('artifacts', artifact.id);
          if (old && !equal(old, artifact)) return refuse('identity-conflict', 'immutable artifact differs');
          if (!old) added.push(artifact);
        }
        if (!nonnegative(buffer.revision + 1) || !nonnegative(buffer.generation + 1) || !nonnegative((prior?.revision ?? -1) + 1))
          return refuse('budget', 'activation revision exhausted');
        const next = { ...buffer, revision: buffer.revision + 1, generation: buffer.generation + 1,
          pending: buffer.pending.filter(id => !selected.has(id)), completedAt };
        const receipt: ConsolidationReceipt = { passId: id, scope, revision: next.revision, generation: next.generation,
          sourceCount: sourceIds.length, artifactIds: artifacts.map(artifact => artifact.id), writes: added.length + 2,
          replayed: false, logicalCalls: prior?.steps.length ?? 0, embeddingItems: artifacts.filter(artifact => artifact.embedding !== undefined).length };
        const operation: ConsolidationOperation = { id, scope, key, requestHash, expectedGeneration, sourceIds, recipeHash,
          maxLogicalCalls: prior?.maxLogicalCalls ?? 0, steps: prior?.steps ?? [], artifacts, receipt,
          revision: (prior?.revision ?? -1) + 1, phase: 'completed', failure: null };
        for (const artifact of added) await tx.put('artifacts', artifact);
        await tx.put('buffers', next);
        await tx.put('operations', operation);
        return success(cloneJson(receipt));
      }, true);
    },
    async operation(scope, key) {
      if (!validScope(scope) || !validScope(key)) return refuse('invalid-operation', 'scope and operation key are required');
      const id = await consolidationOperationId(scope, key);
      return transaction(async tx => success(await tx.get('operations', id) ?? null));
    },
    async reserve(input) {
      const row = { ...input, id: await consolidationOperationId(input.scope, input.key), revision: 0,
        phase: 'reserved' as const, steps: [], artifacts: [], receipt: null, failure: null };
      const checked = checkConsolidation<ConsolidationOperation>('consolidationOperation', row, 'invalid-operation');
      if (checked.status !== 'success') return checked;
      const operation = checked.value;
      return transaction<{ operation: ConsolidationOperation; replayed: boolean }>(async tx => {
        const old = await tx.get('operations', operation.id);
        if (old) return equal(immutableOperation(old), immutableOperation(operation))
          ? success({ operation: old, replayed: true }) : refuse('identity-conflict', 'operation key reserves different inputs or budgets');
        const overlap = await overlappingOperation(tx, operation.scope, operation.sourceIds, operation.id);
        if (overlap) return overlap;
        const buffer = await tx.get('buffers', operation.scope) ?? emptyBuffer(operation.scope);
        if (buffer.generation !== operation.expectedGeneration) return refuse('stale-generation', 'operation parent changed');
        if (operation.sourceIds.some(id => !buffer.pending.includes(id)) || !await verifyReferences(tx, operation.scope, operation.sourceIds))
          return refuse('invalid-source', 'operation sources are not pending in this scope');
        await tx.put('operations', operation);
        return success({ operation: cloneJson(operation), replayed: false });
      });
    },
    async update(input, expectedRevision) {
      const checked = checkConsolidation<ConsolidationOperation>('consolidationOperation', input, 'invalid-operation');
      if (checked.status !== 'success') return checked;
      const next = checked.value;
      for (const artifact of next.artifacts) {
        const result = await validateConsolidationArtifact(artifact);
        if (result.status !== 'success' || artifact.scope !== next.scope || artifact.recipeHash !== next.recipeHash
          || artifact.sourceIds.some(id => !next.sourceIds.includes(id))) return refuse('invalid-operation', 'prepared artifact does not belong to this operation');
      }
      return transaction(async tx => {
        const prior = await tx.get('operations', next.id);
        if (!prior || !equal(immutableOperation(prior), immutableOperation(next))) return refuse('identity-conflict', 'operation identity changed');
        if (equal(prior, next)) return success(cloneJson(prior));
        if (prior.revision !== expectedRevision || next.revision !== expectedRevision + 1) return refuse('invalid-operation', 'operation revision changed');
        if (prior.phase === 'completed' || prior.phase === 'failed' || next.phase === 'completed' || next.phase === 'reserved'
          || prior.phase === 'prepared' && next.phase !== 'prepared' && next.phase !== 'failed') return refuse('invalid-operation', 'invalid operation phase transition');
        if (next.receipt !== null || next.steps.length < prior.steps.length || next.steps.length > next.maxLogicalCalls
          || new Set(next.steps.map(step => step.key)).size !== next.steps.length) return refuse('invalid-operation', 'invalid logical-call ledger');
        for (let i = 0; i < prior.steps.length; i++) {
          const before = prior.steps[i], after = next.steps[i];
          if (before.phase === 'unknown' && after.phase === 'dispatched')
            return refuse('invalid-operation', 'an unknown dispatch cannot be reset for retry');
          if (before.key !== after.key || before.kind !== after.kind || before.requestHash !== after.requestHash
            || (before.phase === 'completed' || before.phase === 'failed') && !equal(before, after))
            return refuse('invalid-operation', 'completed steps and dispatched identities are immutable');
        }
        if (next.steps.some(step => (step.phase === 'dispatched' || step.phase === 'unknown') && step.result !== null))
          return refuse('invalid-operation', 'a pending or unknown dispatch cannot claim a result');
        if (next.steps.length > prior.steps.length && (next.steps.length !== prior.steps.length + 1
          || prior.steps.some(step => step.phase !== 'completed') || next.steps.at(-1)!.phase !== 'dispatched'))
          return refuse('invalid-operation', 'a new call requires every previous result and a durable dispatch');
        if (next.phase === 'prepared' && (!next.artifacts.length || next.steps.some(step => step.phase !== 'completed')))
          return refuse('invalid-operation', 'prepared means complete artifacts and known step results');
        if (next.phase === 'failed' ? next.failure === null : next.failure !== null) return refuse('invalid-operation', 'failure reason and phase differ');
        await tx.put('operations', next);
        return success(cloneJson(next));
      });
    },
  };
  return store;
}

export interface ConsolidationMemoryState {
  sources: ConsolidationSource[]; artifacts: ConsolidationArtifact[];
  buffers: ConsolidationBuffer[]; operations: ConsolidationOperation[];
}
export interface ConsolidationMemoryOptions { state?: ConsolidationMemoryState; applyProbe?: (step: string) => void }
export function createConsolidationMemoryPersistence(options: ConsolidationMemoryOptions = {}): ConsolidationPersistence & {
  exportState(): ConsolidationMemoryState; close(): Promise<void>;
} {
  const names: ConsolidationTable[] = ['sources', 'artifacts', 'buffers', 'operations'];
  let rows = new Map<string, ConsolidationTables[ConsolidationTable]>();
  for (const name of names) for (const row of options.state?.[name] ?? []) rows.set(`${name}:${consolidationRowId(name, row)}`, cloneJson(row));
  const scheduler = createScheduler({ concurrency: 1, maxQueue: 64 });
  return {
    exportState() { return Object.fromEntries(names.map(name => [name, [...rows].filter(([key]) => key.startsWith(`${name}:`)).map(([, row]) => cloneJson(row))])) as unknown as ConsolidationMemoryState; },
    close: () => scheduler.close(),
    transaction<T>(task: (tx: ConsolidationTransaction) => Promise<T>): Promise<T> {
      return scheduler.run(async () => {
        const staged = new Map(rows);
        const result = await task({
          async get<K extends ConsolidationTable>(table: K, id: string) {
            const row = staged.get(`${table}:${id}`); return row === undefined ? undefined : cloneJson(row) as ConsolidationTables[K];
          },
          async list<K extends ConsolidationTable>(table: K, scope: string) {
            return [...staged].filter(([key, row]) => key.startsWith(`${table}:`) && row.scope === scope)
              .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => cloneJson(row) as ConsolidationTables[K]);
          },
          async put(table, row) { staged.set(`${table}:${consolidationRowId(table, row)}`, cloneJson(row)); options.applyProbe?.(`put:${table}`); },
        });
        options.applyProbe?.('commit'); rows = staged; return result;
      });
    },
  };
}
export function createConsolidationMemoryStore(options: ConsolidationMemoryOptions = {}): ConsolidationStore {
  return createConsolidationStoreAdapter(createConsolidationMemoryPersistence(options));
}
