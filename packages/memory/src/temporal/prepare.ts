/** Explicit, bounded preparation. No question text or evaluator fields belong to this API. */
import { createChatClient } from '@tangleai/models/client';
import { createEmbeddingClient } from '@tangleai/models/embed';
import { createStructuredOutput } from '@tangleai/models/structured';
import { temporalSchema } from '@tangleai/core/schemas/temporal';
import { checkTemporal, temporalIdentity, success, refuse, type TemporalResult, type SourceOccurrence, type TemporalClaim, type EmbeddedBy,
  type Knowledge, type TemporalHead, type TemporalLimits, type ProjectionEmbedding, type ProjectionReceipt } from './contracts.ts';
import { validateSourceOccurrence, validateTemporalClaim, validateKnowledge, createTemporalProjection } from './evidence.ts';
import { temporalInstant } from './time.ts';
import type { TemporalStore } from './store.ts';
import { createTemporalExecution, temporalValue, temporalFailure, TemporalFailure, type TemporalExecutionOptions } from './operations.ts';
import { TEMPORAL_EXTRACTION_PROMPT } from './prompts.ts';
import { validateTemporalExtraction } from './proposals.ts';
export interface TemporalModel { provider: string; model: string; baseUrl?: string; apiKey?: string; identity: string }
export interface PrepareTemporalInput {
  scope: string; key: string; sources: readonly SourceOccurrence[]; knowledge: Knowledge; expectedHead: TemporalHead | null;
  sourceIdentity: string; policyIdentity: string; embeddedBy: EmbeddedBy; limits: TemporalLimits;
  /** Host assertions are independently cited; omitted means use the injected structured extractor. */
  claims?: readonly TemporalClaim[];
  /** Precomputed host vectors or an explicit counted embedding transport; absence remains incomplete vector coverage. */
  embeddings?: readonly ProjectionEmbedding[];
}
export interface PrepareTemporalOptions extends Omit<TemporalExecutionOptions, 'fetch'> {
  store: TemporalStore; model?: TemporalModel; embeddingModel?: TemporalModel; fetch?: typeof fetch;
}
export async function prepareTemporal(input: PrepareTemporalInput, options: PrepareTemporalOptions): Promise<TemporalResult<ProjectionReceipt>> {
  let execution: Awaited<ReturnType<typeof createTemporalExecution>> | undefined;
  try {
    const limits = temporalValue(checkTemporal<TemporalLimits>('temporalLimits', input.limits));
    temporalValue(checkTemporal<EmbeddedBy>('embeddedBy', input.embeddedBy));
    const knowledge = temporalValue(validateKnowledge(input.knowledge));
    const cutoff = knowledge.mode === 'strict-as-of' ? temporalValue(temporalInstant(knowledge.cutoff)) : null;
    const sources: SourceOccurrence[] = [];
    for (const candidate of input.sources) {
      const source = temporalValue(await validateSourceOccurrence(candidate));
      if (source.scope !== input.scope) return refuse('identity-mismatch', 'preparation source scope differs');
      if (cutoff === null || temporalValue(temporalInstant(source.knownAt)) <= cutoff) sources.push(source);
    }
    sources.sort((a, b) => a.id.localeCompare(b.id));
    if (sources.length > limits.maxSources) return refuse('budget-exhausted', 'permitted source coverage exceeds the execution plan');
    if (new Set(sources.map(s => s.id)).size !== sources.length) return refuse('identity-mismatch', 'duplicate source occurrence in preparation');
    const permitted = new Set(sources.map(s => s.id));
    for (const claim of input.claims ?? []) {
      if (claim.derivation.method === 'model') return refuse('identity-mismatch', 'model-derived projections must be prepared independently for this knowledge view');
      temporalValue(await validateTemporalClaim(claim, input.sources));
    }
    const allSourceIds = new Set(input.sources.map(s => s.id));
    if (input.embeddings?.some(e => !allSourceIds.has(e.sourceId) || e.vector.length !== input.embeddedBy.dims || !e.vector.every(Number.isFinite))) return refuse('identity-mismatch', 'host vectors have foreign sources, invalid dimensions or components');
    const assertions = input.claims?.filter(c => c.citations.every(s => permitted.has(s.sourceId)));
    if (assertions && assertions.length > limits.maxClaims) return refuse('budget-exhausted', 'asserted claim count exceeds plan');
    const embeddings = input.embeddings?.filter(e => permitted.has(e.sourceId)).map(e => ({ sourceId: e.sourceId, vector: [...e.vector] })) ?? [];
    if (input.embeddings && options.embeddingModel) return refuse('identity-mismatch', 'choose host vectors or embedding transport explicitly');
    const promptIdentity = await temporalIdentity(TEMPORAL_EXTRACTION_PROMPT), viewIdentity = await temporalIdentity({ knowledge, sources });
    const modelIdentity = assertions ? 'host-asserted' : options.model?.identity;
    if (!modelIdentity) return refuse('provider-refusal', 'no extractor supplied');
    if ((!assertions || options.embeddingModel) && !options.fetch) return refuse('provider-refusal', 'model preparation requires an explicitly injected fetch');
    const model = options.model ? { provider: options.model.provider, model: options.model.model, baseUrl: options.model.baseUrl ?? null, identity: options.model.identity } : null;
    const embedModel = options.embeddingModel ? { provider: options.embeddingModel.provider, model: options.embeddingModel.model, baseUrl: options.embeddingModel.baseUrl ?? null, identity: options.embeddingModel.identity } : null;
    if (embedModel && embedModel.model !== input.embeddedBy.model) return refuse('identity-mismatch', 'embedding transport model differs from projection identity');
    const requestIdentity = await temporalIdentity({ scope: input.scope, sourceIdentity: input.sourceIdentity, viewIdentity, policyIdentity: input.policyIdentity,
      schema: temporalSchema, promptIdentity, modelIdentity, model, embedModel, embeddedBy: input.embeddedBy, limits,
      sources, claims: assertions ?? null, embeddings, knowledge, expectedHead: input.expectedHead });
    const reservation = temporalValue(await options.store.reserveOperation({ scope: input.scope, key: input.key, requestIdentity, maxPhysicalRequests: limits.maxPhysicalRequests }));
    if (reservation.replayed) {
      if (reservation.operation.phase === 'completed') {
        const receipt = temporalValue(checkTemporal<ProjectionReceipt>('projectionReceipt', reservation.operation.receipt));
        return success({ ...receipt, replayed: true, writes: 0, activations: 0 });
      }
      return refuse('provider-refusal', `operation-${reservation.operation.phase}: automatic retry is disabled; inspect the durable receipt`);
    }
    execution = await createTemporalExecution(options.store, reservation.operation, limits, { ...options,
      fetch: options.fetch ?? (async () => { throw new TemporalFailure(refuse('provider-refusal', 'no temporal transport supplied')); }) });
    let claims: TemporalClaim[];
    if (assertions) claims = [...assertions];
    else {
      const transport = execution; let calls = 0;
      const client = createChatClient({ ...options.model!, retry: { attempts: 1 }, maxTokens: limits.maxOutputTokens,
        fetch: (url, init) => transport.transport(calls++ === 0 ? 'extract' : 'repair')(url, init) });
      const generator = createStructuredOutput({ client, schema: { $defs: temporalSchema.$defs, $ref: '#/$defs/extractionProposal' }, maxRepairs: limits.maxRepairs });
      const output = await generator.generate([{ role: 'system', content: TEMPORAL_EXTRACTION_PROMPT.text },
        { role: 'user', content: JSON.stringify({ scope: input.scope, sources }) }], { signal: execution.signal });
      if (output.errors) throw new TemporalFailure(refuse('identity-mismatch', 'extractor proposal remained invalid after bounded structured repair'));
      claims = temporalValue(await validateTemporalExtraction(output.value, sources, input.scope, await temporalIdentity({ modelIdentity, promptIdentity }), limits.maxClaims));
    }
    if (options.embeddingModel && sources.length) {
      const embedder = createEmbeddingClient({ ...options.embeddingModel, dims: input.embeddedBy.dims, retry: { attempts: 1 },
        timeoutMs: limits.deadlineMs, fetch: execution.transport('embedding') });
      const vectors = await embedder.embed(sources.map(s => s.text), { signal: execution.signal });
      sources.forEach((s, i) => embeddings.push({ sourceId: s.id, vector: Array.from(vectors[i]) }));
    }
    const bundle = temporalValue(await createTemporalProjection({ scope: input.scope, sources, claims, knowledge,
      sourceIdentity: input.sourceIdentity, viewIdentity, policyIdentity: input.policyIdentity, modelIdentity, promptIdentity,
      embeddedBy: input.embeddedBy, embeddings, complete: true }));
    const operation = execution.operation();
    const result = await options.store.apply(bundle, { key: input.key, expectedHead: input.expectedHead,
      operation: { requestIdentity, revision: operation.revision }, signal: execution.signal });
    if (result.status !== 'success') await execution.fail(result);
    return result;
  } catch (cause) { const refusal = temporalFailure(cause); await execution?.fail(refusal); return refusal; }
  finally { execution?.close(); }
}
