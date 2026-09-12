/** Confidence and its terminal per-id receipt use the same transaction owner. */
import { projectOutcomeConfidence } from '@tangleai/memory/outcome';
import { equalsJson } from '@jarenjs/core/object';
import { outcomeRevision } from './identity.ts';
import { checkedMemory } from './store.ts';
import { semantic, putRecord, unique } from './persistence.ts';
import { reject } from './errors.ts';
import { recordOf, requireNew, seal } from './service-context.ts';
import { scoreUtility } from './domain.ts';
import type { ServiceContext } from './service-context.ts';
import type { OutcomeTransaction } from './store.ts';
import type { ProjectCommand, ProjectionItem } from './outcomes.contracts.gen.ts';

export async function prepareProjection(context: ServiceContext, c: ProjectCommand) {
  const data = await context.atomic().transaction(async tx => {
    await requireNew(tx, c.scopeId, 'projection', c.input.scoreId);
    const score = await recordOf(tx, c.input.scoreId, c.scopeId, c.artifactKey, 'score');
    const id = await semantic(tx, c.scopeId, 'projectionIntent', score.id);
    if (!id) reject('OUTC1002', 'Score has no projection intent.');
    const intent = await recordOf(tx, id, c.scopeId, c.artifactKey, 'projectionIntent');
    const decision = await recordOf(tx, score.decisionId, c.scopeId, c.artifactKey, 'decision');
    const resolution = await recordOf(tx, score.resolutionId, c.scopeId, c.artifactKey, 'resolution');
    const { adapter, domain } = context.adapter(decision.adapter);
    const verdict = adapter.score(domain.output(decision.output), domain.resolution(resolution.payload));
    if (resolution.decisionId !== decision.id || score.scorerRevision !== adapter.identity.scorerRevision || verdict.outcome !== score.outcome || score.utility !== scoreUtility(score.outcome)) reject('OUTC1002', 'Projection score joins or utility differ.');
    if (intent.scoreId !== score.id || intent.policyId !== context.confidencePolicyId || score.policyId !== context.confidencePolicyId) reject('OUTC1008', 'Projection policy or intent binding differs.');
    if (!equalsJson(intent.memoryIds, [...new Set(decision.memoryIds)].sort())) reject('OUTC1002', 'Projection citations differ from the decision.');
    if (c.at < score.recordedAt) reject('OUTC1001', 'Projection time precedes its score.');
    return { score, intent };
  });
  if (await context.authorization(data.intent.memoryIds) !== data.intent.authorizationId) reject('OUTC1003', 'Memory authorization binding changed.');
  return data;
}
export async function commitProjection(tx: OutcomeTransaction, context: ServiceContext, c: ProjectCommand, data: Awaited<ReturnType<typeof prepareProjection>>) {
  await requireNew(tx, c.scopeId, 'projection', data.score.id);
  const items: ProjectionItem[] = [];
  for (const memoryId of data.intent.memoryIds) {
    const raw = await tx.get('memories', memoryId);
    if (!raw) { items.push({ memoryId, before: null, after: null, status: 'missing', changed: false }); continue; }
    const before = checkedMemory(raw), after = projectOutcomeConfidence(before, data.score.outcome, context.confidencePolicy);
    const changed = !equalsJson(before, after);
    if (changed) await tx.put('memories', after);
    items.push({ memoryId, before: await outcomeRevision(before), after: await outcomeRevision(after), status: 'applied', changed });
  }
  const receipt = await seal('projectionReceipt', c.scopeId, c.artifactKey, c.at, {
    scoreId: data.score.id, intentId: data.intent.id, policyId: context.confidencePolicyId, items,
    applied: items.filter(v => v.status === 'applied').length, missing: items.filter(v => v.status === 'missing').length,
    changedMemoryWrites: items.filter(v => v.changed).length,
  });
  await putRecord(tx, receipt); await unique(tx, c.scopeId, 'projection', data.score.id, receipt.id);
  return { projectionReceiptId: receipt.id, applied: receipt.applied, missing: receipt.missing, changedMemoryWrites: receipt.changedMemoryWrites };
}
