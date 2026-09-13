/** Closed public operations over the existing runner and Jaren local dispatcher. */
import { compileContract, type Contract } from '@jarenjs/contract';
import { openLocalClient, type LocalClient } from '@jarenjs/contract/local';
import type { Handler } from '@jarenjs/contract/http';
import { CONSOLIDATION_SCHEMA } from '@tangleai/core/schemas/consolidation';
import type { ConsolidationSource, ConsolidationTriggerRequest, ConsolidationRunRequest, ConsolidationResolution } from './contracts.ts';
import type { ConsolidationRunner } from './runner.ts';
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (name: string) => ({ type: 'array', items: ref(name) });
const result = (value: unknown) => ({ anyOf: [object({ status: { enum: ['success'] }, value }),
  object({ status: { enum: ['refused'] }, reason: ref('consolidationReason'), detail: { type: 'string' } })] });
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const consolidationContractDocument = {
  $contract: '0.1', id: 'tangle-consolidation', version: '1', $defs: CONSOLIDATION_SCHEMA.$defs,
  operations: {
    'consolidation.enqueue': { kind: 'command', doc: 'Admit exact source occurrences atomically under the host pending capacity.',
      input: object({ sources: { ...array('consolidationSource'), minItems: 1 } }),
      output: result(object({ admitted: integer, replayed: integer, writes: integer, buffer: ref('consolidationBuffer') })) },
    'consolidation.inspect': { kind: 'read', doc: 'Read source, artifact, buffer and operation state without mutation.',
      input: object({ scope: { type: 'string', minLength: 1 } }),
      output: result(object({ buffer: ref('consolidationBuffer'), sources: array('consolidationSource'), artifacts: array('consolidationArtifact'), operations: array('consolidationOperation') })) },
    'consolidation.run': { kind: 'command', doc: 'Evaluate explicit trigger eligibility and run or resume one bounded durable pass.',
      input: ref('consolidationTriggerRequest'), output: ref('consolidationExecutionResult') },
    'consolidation.resolve': { kind: 'command', doc: 'Record a validated stopped-host resolution of an uncertain callback; never dispatches one.',
      input: object({ request: ref('consolidationRunRequest'), resolution: ref('consolidationResolution') }), output: result(ref('consolidationOperation')) },
  },
};
export function createConsolidationContract(): Contract { return compileContract(consolidationContractDocument); }
export function createConsolidationHandlers(runner: ConsolidationRunner): Record<string, Handler> {
  return {
    'consolidation.enqueue': (input, context) => runner.enqueue((input as { sources: ConsolidationSource[] }).sources, { signal: context.signal ?? undefined }),
    'consolidation.inspect': (input, context) => runner.inspect((input as { scope: string }).scope, { signal: context.signal ?? undefined }),
    'consolidation.run': (input, context) => runner.run(input as ConsolidationTriggerRequest, { signal: context.signal ?? undefined }),
    'consolidation.resolve': (input, context) => { const value = input as { request: ConsolidationRunRequest; resolution: ConsolidationResolution };
      return runner.resolve(value.request, value.resolution, { signal: context.signal ?? undefined }); },
  };
}
export type ConsolidationOperations = Readonly<Pick<LocalClient, 'invoke' | 'describe' | 'contract'> & { close(): Promise<void> }>;
export function createConsolidationOperations(runner: ConsolidationRunner): ConsolidationOperations {
  const client = openLocalClient(createConsolidationContract(), createConsolidationHandlers(runner));
  return Object.freeze({ invoke: client.invoke, describe: client.describe, contract: client.contract,
    async close() { client.close(); await runner.close(); } });
}
