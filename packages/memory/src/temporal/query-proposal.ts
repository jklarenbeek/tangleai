/** Model-assisted query proposals share the durable, counted transport protocol. */
import { createChatClient } from '@tangleai/models/client';
import { createStructuredOutput } from '@tangleai/models/structured';
import { temporalSchema } from '@tangleai/core/schemas/temporal';
import { checkTemporal, temporalIdentity, refuse, type TemporalLimits, type Stamp, type Json, type QueryProposal } from './contracts.ts';
import { createTemporalExecution, temporalValue, temporalFailure, TemporalFailure, type TemporalExecutionOptions } from './operations.ts';
import { resolveTemporalProposal, type TemporalClockOptions } from './resolve.ts';
import { TEMPORAL_RESOLUTION_PROMPT } from './prompts.ts';
import type { TemporalModel } from './prepare.ts';
import type { TemporalStore } from './store.ts';
export async function proposeTemporalQuery(input: { scope: string; key: string; text: string; anchor: Stamp | null; limits: TemporalLimits; clockIdentity: string },
  options: TemporalExecutionOptions & TemporalClockOptions & { store: TemporalStore; model: TemporalModel }) {
  let execution: Awaited<ReturnType<typeof createTemporalExecution>> | undefined;
  try {
    const limits = temporalValue(checkTemporal<TemporalLimits>('temporalLimits', input.limits));
    const promptIdentity = await temporalIdentity(TEMPORAL_RESOLUTION_PROMPT);
    const requestIdentity = await temporalIdentity({ ...input, schema: temporalSchema, promptIdentity,
      model: { provider: options.model.provider, model: options.model.model, baseUrl: options.model.baseUrl ?? null, identity: options.model.identity },
      clock: { zone: options.zone ?? null, disambiguation: options.disambiguation ?? 'reject', identity: input.clockIdentity } });
    const reserved = temporalValue(await options.store.reserveOperation({ scope: input.scope, key: input.key, requestIdentity, maxPhysicalRequests: limits.maxPhysicalRequests }));
    if (reserved.replayed) {
      if (reserved.operation.phase !== 'completed') return refuse('provider-refusal', `operation-${reserved.operation.phase}: query retry requires an explicit new operation`);
      const proposal = temporalValue(checkTemporal<QueryProposal>('queryProposal', reserved.operation.receipt));
      return resolveTemporalProposal(proposal, input.text, input.anchor, options);
    }
    execution = await createTemporalExecution(options.store, reserved.operation, limits, options);
    const transport = execution; let calls = 0;
    const client = createChatClient({ ...options.model, retry: { attempts: 1 }, maxTokens: limits.maxOutputTokens,
      fetch: (url, init) => transport.transport(calls++ === 0 ? 'resolve' : 'repair')(url, init) });
    const generated = await createStructuredOutput({ client, schema: { $defs: temporalSchema.$defs, $ref: '#/$defs/queryProposal' }, maxRepairs: limits.maxRepairs })
      .generate([{ role: 'system', content: TEMPORAL_RESOLUTION_PROMPT.text }, { role: 'user', content: JSON.stringify({ text: input.text }) }], { signal: execution.signal });
    if (generated.errors) throw new TemporalFailure(refuse('identity-mismatch', 'invalid query proposal after bounded repair'));
    const proposal = temporalValue(checkTemporal<QueryProposal>('queryProposal', generated.value));
    const result = resolveTemporalProposal(proposal, input.text, input.anchor, options);
    const operation = execution.operation();
    temporalValue(await options.store.updateOperation({ ...operation, revision: operation.revision + 1, phase: 'completed', receipt: proposal as unknown as Json }, operation.revision));
    return result;
  } catch (cause) { const refusal = temporalFailure(cause); await execution?.fail(refusal); return refusal; }
  finally { execution?.close(); }
}
