/** Reserve before dispatch, persist known results, and activate the complete pass atomically. */
import { cloneJson } from '@jarenjs/core/object';
import { sizeOf } from '@jarenjs/core/chunk';
import { consolidationHash, consolidationSuccess as success, consolidationRefusal as refuse,
  checkConsolidation, createConsolidationArtifact, consolidationCompletionTime, type ConsolidationOperation, type ConsolidationStep,
  type ConsolidationExecutionResult, type ConsolidationCallAccounting, type ConsolidationResult, type ConsolidationReceipt, type ConsolidationReason, type ConsolidationJson,
  type ConsolidationSynthesis, type ConsolidationSupport, type ConsolidationEmbedding,
  type ConsolidationSynthesisBounds, type ConsolidationRunRequest, type ConsolidationResolution } from './contracts.ts';
import type { ConsolidationStore } from './types.ts';
import { consolidationEvidence, planDeterministicConsolidation } from './deterministic.ts';
import { consolidationTerms } from './lexical.ts';
import { DEFAULT_CONSOLIDATION_SYNTHESIS_BOUNDS, CONSOLIDATION_SYNTHESIS_INSTRUCTION, CONSOLIDATION_SUPPORT_INSTRUCTION,
  validateConsolidationStepResult, type ConsolidationSynthesisSeams } from './synthesis.ts';
export type ConsolidationExecuteInput = ConsolidationRunRequest & { signal?: AbortSignal };
function callAccounting(operation: ConsolidationOperation | null, invoked: number): ConsolidationCallAccounting {
  const steps = operation?.steps ?? [];
  const rejected = (step: ConsolidationStep) => step.phase === 'completed' && step.result !== null
    && typeof step.result === 'object' && !Array.isArray(step.result) && step.result.status === 'refused';
  const synthesis = steps.find(step => step.kind === 'synthesis' && step.phase === 'completed')?.result as ConsolidationSynthesis | undefined;
  return { reservedCalls: steps.length, completedCalls: steps.filter(step => step.phase === 'completed' && !rejected(step)).length,
    refusedCalls: steps.filter(rejected).length, failedCalls: steps.filter(step => step.phase === 'failed').length,
    unknownCalls: steps.filter(step => step.phase === 'unknown' || step.phase === 'dispatched').length, invoked,
    embeddingItems: steps.some(step => step.kind === 'embedding') && synthesis?.status === 'ok' ? synthesis.claims.length : 0 };
}
export function createConsolidationExecutor(options: ConsolidationSynthesisSeams & {
  store: ConsolidationStore; bounds?: Partial<ConsolidationSynthesisBounds>;
}) {
  const store = options.store;
  const boundsCheck = checkConsolidation<ConsolidationSynthesisBounds>('consolidationSynthesisBounds',
    { ...DEFAULT_CONSOLIDATION_SYNTHESIS_BOUNDS, ...options.bounds }, 'budget');
  if (boundsCheck.status !== 'success') throw new TypeError(boundsCheck.detail);
  const bounds = Object.freeze(boundsCheck.value);
  if (!options.synthesizer?.id?.trim() || !options.verifier?.id?.trim()
    || typeof options.synthesizer.run !== 'function' || typeof options.verifier.run !== 'function'
    || options.embedder && (!options.embedder.model?.trim() || !Number.isSafeInteger(options.embedder.dims)
      || options.embedder.dims < 1 || typeof options.embedder.embed !== 'function')) throw new TypeError('named synthesis/support and valid fresh embedding seams are required');
  const synthesize = options.synthesizer.run.bind(options.synthesizer), verify = options.verifier.run.bind(options.verifier);
  const embed = options.embedder?.embed.bind(options.embedder);
  const embedder = options.embedder ? { model: options.embedder.model, dims: options.embedder.dims } : undefined;
  const recipe = { method: 'supported-consolidation-v1', bounds, synthesizer: options.synthesizer.id,
    verifier: options.verifier.id, embedder: embedder ?? null,
    synthesisInstruction: CONSOLIDATION_SYNTHESIS_INSTRUCTION, supportInstruction: CONSOLIDATION_SUPPORT_INSTRUCTION };
  async function prepare(input: ConsolidationExecuteInput) {
    const { signal: _, ...data } = input;
    const checked = checkConsolidation<ConsolidationRunRequest>('consolidationRunRequest', data, 'invalid-operation');
    if (checked.status !== 'success') return checked;
    const request = { ...checked.value, tier: checked.value.tier ?? 'semantic' as const };
    if (request.sourceIds.length > bounds.maxSources) return refuse('budget', 'source count exceeds synthesis bound');
    const state = await store.snapshot(request.scope); if (state.status !== 'success') return state;
    const lookup = new Map(state.value.sources.map(source => [source.id, source]));
    if (request.sourceIds.some(id => !lookup.has(id))) return refuse('invalid-source', 'exact synthesis sources are missing');
    const sources = request.sourceIds.map(id => lookup.get(id)!);
    const evidence = consolidationEvidence(sources);
    const synthesisRequest = { instruction: CONSOLIDATION_SYNTHESIS_INSTRUCTION, sources: evidence };
    if (sizeOf(JSON.stringify(synthesisRequest)) > bounds.maxInputChars) return refuse('budget', 'synthesis input exceeds characters');
    const recipeHash = await consolidationHash({ ...recipe, tier: request.tier });
    const requestHash = await consolidationHash({ scope: request.scope, key: request.key,
      sourceIds: request.sourceIds, expectedGeneration: request.expectedGeneration, recipeHash });
    return success({ request, sources, evidence, synthesisRequest, recipeHash, requestHash });
  }
  async function execute(input: ConsolidationExecuteInput, context: { completionClock?: () => number } = {}): Promise<ConsolidationExecutionResult> {
    let operation: ConsolidationOperation | null = null, invoked = 0;
    const answer = (result: ConsolidationResult<ConsolidationReceipt>): ConsolidationExecutionResult =>
      ({ ...result, operationId: operation?.id ?? null, accounting: callAccounting(operation, invoked) });
    if (input.signal?.aborted) return answer(refuse('cancelled', 'cancelled before reservation'));
    const preparedInput = await prepare(input); if (preparedInput.status !== 'success') return answer(preparedInput);
    const { request, sources, evidence, synthesisRequest, recipeHash, requestHash } = preparedInput.value;
    if (bounds.maxLogicalCalls < (embed ? 3 : 2)) return answer(refuse('budget', 'logical-call ceiling cannot fund the whole supported pass'));
    const reserved = await store.reserve({ scope: request.scope, key: request.key, requestHash,
      expectedGeneration: request.expectedGeneration, sourceIds: request.sourceIds, recipeHash, maxLogicalCalls: bounds.maxLogicalCalls });
    if (reserved.status !== 'success') return answer(reserved);
    operation = reserved.value.operation;
    async function update(change: Partial<ConsolidationOperation>) {
      const before = operation!;
      const result = await store.update({ ...before, ...change, revision: before.revision + 1 }, before.revision);
      if (result.status === 'success') operation = result.value;
      return result;
    }
    async function fail(reason: ConsolidationReason, detail: string) {
      const result = await update({ phase: 'failed', failure: reason });
      return result.status === 'success' ? refuse(reason, detail) : result;
    }
    async function step(kind: ConsolidationStep['kind'], payload: unknown, callback: () => Promise<unknown>, claims?: ConsolidationSynthesis & { status: 'ok' }): Promise<ConsolidationResult<ConsolidationJson>> {
      const hash = await consolidationHash({ kind, payload, recipeHash });
      const prior = operation!.steps.find(value => value.key === kind);
      const validationContext = { sources: evidence, claims: claims?.claims, bounds, embedder };
      if (prior) {
        if (prior.requestHash !== hash) return refuse('identity-conflict', 'staged request payload changed');
        if (prior.phase !== 'completed') return refuse(prior.phase === 'failed' ? operation!.failure ?? 'invalid-artifact' : 'unknown', 'dispatched work requires explicit stopped-host resolution');
        return validateConsolidationStepResult(kind, prior.result, validationContext);
      }
      if (input.signal?.aborted) return refuse('cancelled', 'cancelled before next dispatch');
      if (operation!.steps.length >= bounds.maxLogicalCalls || sizeOf(JSON.stringify(payload)) > bounds.maxInputChars)
        return fail('budget', 'logical call or rendered input bound exhausted');
      const dispatched: ConsolidationStep = { key: kind, kind, requestHash: hash, phase: 'dispatched', result: null, detail: null };
      const saved = await update({ phase: 'working', steps: [...operation!.steps, dispatched] });
      if (saved.status !== 'success') return saved;
      const replace = (value: ConsolidationStep) => operation!.steps.map(row => row.key === kind ? value : row);
      if (input.signal?.aborted) {
        const cancelled = await update({ phase: 'failed', failure: 'cancelled', steps: replace({ ...dispatched, phase: 'failed', detail: 'cancelled before invocation' }) });
        return cancelled.status === 'success' ? refuse('cancelled', 'cancelled before invocation') : cancelled;
      }
      let raw: unknown;
      try { invoked++; raw = await callback(); }
      catch (cause) {
        await update({ steps: replace({ ...dispatched, phase: 'unknown', detail: cause instanceof Error ? cause.message : String(cause) }) });
        return refuse('unknown', 'callback threw after dispatch; external outcome is unknown');
      }
      const checked = validateConsolidationStepResult(kind, raw, validationContext);
      const completed = checked.status === 'success'
        ? { ...dispatched, phase: 'completed' as const, result: checked.value }
        : { ...dispatched, phase: 'failed' as const, detail: checked.detail };
      const persisted = await update({ steps: replace(completed), ...(checked.status === 'refused' ? { phase: 'failed' as const, failure: checked.reason } : {}) });
      if (persisted.status !== 'success') return refuse('unknown', 'callback returned but its durable result is unconfirmed; explicit resolution is required');
      return checked;
    }
    if (operation.phase === 'failed') return answer(refuse(operation.failure!, 'the pass has a durable terminal failure'));
    if (operation.phase !== 'prepared' && operation.phase !== 'completed') {
      const synthesized = await step('synthesis', synthesisRequest, () => synthesize(cloneJson(synthesisRequest), { signal: input.signal }));
      if (synthesized.status !== 'success') return answer(synthesized);
      const synthesis = synthesized.value as unknown as ConsolidationSynthesis;
      if (synthesis.status === 'refused') return answer(await fail('refusal', synthesis.detail));
      const supportRequest = { instruction: CONSOLIDATION_SUPPORT_INSTRUCTION, sources: evidence, claims: synthesis.claims };
      const supported = await step('support', supportRequest, () => verify(cloneJson(supportRequest), { signal: input.signal }), synthesis);
      if (supported.status !== 'success') return answer(supported);
      const support = supported.value as unknown as ConsolidationSupport;
      if (support.status === 'refused') return answer(await fail('refusal', support.detail));
      if (support.supported.some(value => !value)) return answer(await fail('unsupported', 'support verifier rejected a claim'));
      let vectors: ConsolidationEmbedding | undefined;
      if (embed) {
        if (synthesis.claims.length > bounds.maxEmbeddingItems) return answer(await fail('budget', 'fresh embedding item bound exhausted'));
        const texts = synthesis.claims.map(claim => claim.text);
        const result = await step('embedding', { texts, identity: embedder }, () => embed([...texts], { signal: input.signal }), synthesis);
        if (result.status !== 'success') return answer(result);
        vectors = result.value as unknown as ConsolidationEmbedding;
      }
      const artifacts = [];
      for (const [i, claim] of synthesis.claims.entries()) {
        const result = await createConsolidationArtifact({ scope: request.scope, recipeHash, tier: request.tier,
          text: claim.text, sourceIds: claim.sourceIds, keywords: [...new Set(consolidationTerms(claim.text))].slice(0, 8),
          ...(vectors ? { embedding: vectors.vectors[i], embeddedBy: embedder! } : {}) });
        if (result.status !== 'success') return answer(await fail(result.reason, result.detail));
        artifacts.push(result.value);
      }
      if (request.tier === 'combined') {
        const plan = await planDeterministicConsolidation(sources, { maxSources: bounds.maxSources, maxInputChars: bounds.maxInputChars });
        if (plan.status !== 'success') return answer(await fail(plan.reason, plan.detail));
        for (const artifact of plan.value.artifacts) {
          const combined = await createConsolidationArtifact({ ...artifact, tier: 'combined', recipeHash });
          if (combined.status !== 'success') return answer(await fail(combined.reason, combined.detail));
          if (!artifacts.some(value => value.id === combined.value.id)) artifacts.push(combined.value);
        }
      }
      if (artifacts.reduce((total, artifact) => total + artifact.text.length, 0) > bounds.maxOutputChars)
        return answer(await fail('budget', 'complete artifact text exceeds output bound'));
      const staged = await update({ phase: 'prepared', artifacts });
      if (staged.status !== 'success') return answer(staged);
    }
    if (input.signal?.aborted) return answer(refuse('cancelled', 'cancelled before atomic activation'));
    const completion = consolidationCompletionTime(request.completedAt, context.completionClock);
    if (completion.status !== 'success') return answer(completion);
    const activated = await store.apply({ ...request, completedAt: completion.value, recipeHash, artifacts: operation!.artifacts,
      operation: { revision: operation!.revision, requestHash } });
    if (activated.status === 'refused' && activated.reason === 'stale-generation')
      return answer(await fail('stale-generation', 'a disjoint activation advanced the parent; this prepared pass cannot activate'));
    return answer(activated);
  }
  async function resolve(input: ConsolidationExecuteInput, value: ConsolidationResolution): Promise<ConsolidationResult<ConsolidationOperation>> {
    const resolution = checkConsolidation<ConsolidationResolution>('consolidationResolution', value, 'invalid-operation');
    if (resolution.status !== 'success') return resolution;
    const context = await prepare(input); if (context.status !== 'success') return context;
    const found = await store.operation(context.value.request.scope, context.value.request.key); if (found.status !== 'success') return found;
    const operation = found.value, request = resolution.value;
    if (!operation || operation.requestHash !== context.value.requestHash || operation.revision !== request.revision
      || operation.phase !== 'working') return refuse('invalid-operation', 'resolution must name the exact stopped operation revision');
    const last = operation.steps.at(-1);
    if (!last || !['unknown', 'dispatched'].includes(last.phase) || last.requestHash !== request.requestHash)
      return refuse('invalid-operation', 'resolution must name the uncertain dispatch');
    if ('failure' in request) return store.update({ ...operation, revision: operation.revision + 1, phase: 'failed', failure: request.failure,
      steps: [...operation.steps.slice(0, -1), { ...last, phase: 'failed', detail: 'host confirms terminal failure after stopping prior work' }] }, operation.revision);
    const synthesis = operation.steps.find(step => step.kind === 'synthesis' && step.phase === 'completed')?.result as ConsolidationSynthesis | undefined;
    const checked = validateConsolidationStepResult(last.kind, request.result, { sources: context.value.evidence,
      claims: synthesis?.status === 'ok' ? synthesis.claims : undefined, bounds, embedder });
    if (checked.status !== 'success') return checked;
    return store.update({ ...operation, revision: operation.revision + 1,
      steps: [...operation.steps.slice(0, -1), { ...last, phase: 'completed', result: checked.value, detail: 'explicit stopped-host result' }] }, operation.revision);
  }
  return Object.freeze({ execute, resolve, bounds, store });
}
