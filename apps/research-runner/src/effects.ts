/** One durable Evolve fence covers setup, measured execution, stable capture and cleanup. */
import { createExternalEffects } from '@jarenjs/flow';
import { equalsJson } from '@jarenjs/core/object';
import { createEffectDriver, type EffectPlan, type DispatchContext } from '@tangleai/evolve/host';
import { createEvolveEffectStore, type TangleDb } from '@tangleai/store';
import { researchExecutionRequest, decodeResearchExecutionRequest, researchExecutionResponse, researchRefuse, researchValue,
  validateResearchShape, validateResearchExecutionResult, type ResearchExecutionRequest, type ResearchExecutionResponse } from '@tangleai/research';
import type { ResearchRunnerBackend } from './host.ts';

export function createFencedResearchBackend(options: { db: TangleDb; engine: ResearchRunnerBackend;
  owner: string; onDispatch?: () => void; onSettled?: () => void }): ResearchRunnerBackend {
  const store = createEvolveEffectStore(options.db, { maxLegs: 1, maxBytes: 67108864 }), engine = options.engine;
  const onDispatch = options.onDispatch, onSettled = options.onSettled, owner = options.owner;
  return { capability: signal => engine.capability(signal), async run(input, signal) {
    const admitted = await researchExecutionRequest(input.manifest, input.workspace, input);
    if (!admitted.valid) return researchExecutionResponse(input.manifest.executionManifestHash, admitted);
    const wire = admitted.value, hash = wire.manifest.executionManifestHash;
    const plan: EffectPlan = { id: 'research/' + hash, jobId: 'research-' + hash, kind: 'research-' + hash,
      actor: 'research-runner', reason: 'Run one frozen research manifest and preserve its complete settlement.', hashVersion: 'research-container/v1',
      legs: [{ id: 'container', request: { safety: 'single-send', input: wire }, maxAttempts: 1 }] };
    const external = createExternalEffects({ store, authorize: (value: unknown) => equalsJson(value, plan), executor: {
      async execute(request: { input: ResearchExecutionRequest }, context: DispatchContext) {
        if (!await context.beforeDispatch() || !context.budget.take()) return { state: 'refused' };
        onDispatch?.();
        const decoded = researchValue(await decodeResearchExecutionRequest(request.input));
        // Client cancellation stops the measured container. The fence remains
        // alive through cleanup so a known cancelled result can be persisted.
        const receipt = await engine.run(decoded, signal);
        onSettled?.();
        return { state: 'ok', receipt };
      },
    }, classify: async (response: { receipt: unknown }) => {
      const receipt = researchValue(validateResearchShape<ResearchExecutionResponse>('ResearchExecutionResponse', response.receipt));
      if (receipt.executionManifestHash !== hash || receipt.settlement === 'unresolved') return { state: 'unresolved', evidence: { reason: 'uncertain-container-settlement' } };
      if (receipt.outcome.valid) {
        if (receipt.settlement !== 'settled') return { state: 'unresolved', evidence: { reason: 'invalid-settlement' } };
        const decoded = researchValue(await decodeResearchExecutionRequest(wire));
        const checked = await validateResearchExecutionResult({ run: receipt.outcome.value.run,
          artifacts: receipt.outcome.value.artifacts.map(row => ({ artifactId: row.artifactId, bytes: new Uint8Array(row.bytes) })) }, decoded.manifest, decoded.workspace, decoded);
        if (!checked.valid || checked.value.run.isolation?.kind !== 'container') return { state: 'unresolved', evidence: { reason: 'invalid-execution-receipt' } };
      } else if (receipt.settlement !== 'not-started') return { state: 'unresolved', evidence: { reason: 'invalid-refusal-settlement' } };
      return { state: 'confirmed', evidence: { receipt } };
    } });
    const driver = createEffectDriver({ jobs: options.db.jobs as never, effects: store as never, external: external as never,
      owner, leaseMs: 600000 });
    const result = await driver.run(plan), held = await store.get(plan.id) as { legs?: Array<{ state: string; evidence?: { receipt?: unknown } }> } | null;
    const leg = held?.legs?.[0];
    if (result.ok && leg?.state === 'confirmed' && leg.evidence?.receipt)
      return researchValue(validateResearchShape<ResearchExecutionResponse>('ResearchExecutionResponse', leg.evidence.receipt));
    return researchExecutionResponse(hash, researchRefuse('TRSH1008', '/effects', 'Execution intent is unresolved or held by another worker; automatic redispatch is refused.',
      result.ok ? undefined : result.issues[0]), 'unresolved');
  } };
}
