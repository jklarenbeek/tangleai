/** Scores commit with a projection intent; projection is independently retryable. */
import { checkShape } from './schema.ts';
import { outcomeRevision } from './identity.ts';
import { scoreUtility } from './domain.ts';
import { reject } from './errors.ts';
import { putRecord, unique } from './persistence.ts';
import { recordOf, requireNew, seal, asJson } from './service-context.ts';
import type { ServiceContext } from './service-context.ts';
import type { OutcomeTransaction } from './store.ts';
import type { ScoreCommand } from './outcomes.contracts.gen.ts';

export async function prepareScore(context: ServiceContext, c: ScoreCommand) {
  const { resolution, decision } = await context.atomic().transaction(async tx => {
    const resolution = await recordOf(tx, c.input.resolutionId, c.scopeId, c.artifactKey, 'resolution');
    await requireNew(tx, c.scopeId, 'score', resolution.decisionId);
    const decision = await recordOf(tx, resolution.decisionId, c.scopeId, c.artifactKey, 'decision');
    return { resolution, decision };
  });
  const { adapter, domain } = context.adapter(decision.adapter);
  if (resolution.resolutionSchema !== adapter.identity.resolutionSchema || c.at < resolution.recordedAt) reject('OUTC1008', 'Score schema or chronology differs from its resolution.');
  const answer = adapter.score(domain.output(decision.output), domain.resolution(resolution.payload));
  const outcome = checkShape<'success' | 'partial' | 'failure'>('category', answer.outcome);
  const diagnostics = asJson({ adapter: answer.diagnostics, inputDigest: await outcomeRevision(decision.input), outputDigest: await outcomeRevision(decision.output), resolutionDigest: await outcomeRevision(resolution.payload) });
  const memoryIds = [...new Set(decision.memoryIds)].sort();
  const authorizationId = await context.authorization(memoryIds);
  return { resolution, decision, outcome, diagnostics, memoryIds, authorizationId };
}
export async function commitScore(tx: OutcomeTransaction, context: ServiceContext, c: ScoreCommand, data: Awaited<ReturnType<typeof prepareScore>>) {
  await requireNew(tx, c.scopeId, 'score', data.decision.id);
  const score = await seal('score', c.scopeId, c.artifactKey, c.at, {
    decisionId: data.decision.id, resolutionId: data.resolution.id, scorerRevision: data.decision.adapter.scorerRevision,
    outcome: data.outcome, utility: scoreUtility(data.outcome), diagnostics: data.diagnostics, policyId: context.confidencePolicyId,
  });
  const intent = await seal('projectionIntent', c.scopeId, c.artifactKey, c.at, { scoreId: score.id, memoryIds: data.memoryIds, authorizationId: data.authorizationId, policyId: context.confidencePolicyId });
  await putRecord(tx, score); await putRecord(tx, intent);
  await unique(tx, c.scopeId, 'score', data.decision.id, score.id);
  await unique(tx, c.scopeId, 'projectionIntent', score.id, intent.id);
  return { scoreId: score.id, projectionIntentId: intent.id };
}
