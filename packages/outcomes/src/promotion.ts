/** Approval and activation are distinct immutable events under one head CAS. */
import { equalsJson } from '@jarenjs/core/object';
import { keyId } from './identity.ts';
import { checkShape } from './schema.ts';
import { reject } from './errors.ts';
import { readRecord, semantic, unique, putRecord, headFor } from './persistence.ts';
import { recordOf, seal, asJson } from './service-context.ts';
import { assertHead, planHeadTransition, planPromotion } from './transitions.ts';
import { checkedEvaluation } from './evaluation.ts';
import type { ServiceContext } from './service-context.ts';
import type { OutcomeTransaction } from './store.ts';
import type { Approval, ArtifactVersion, ApproveCommand, PromoteCommand, RollbackCommand, HeadRow, Operation } from './outcomes.contracts.gen.ts';

async function previouslyActive(tx: OutcomeTransaction, context: ServiceContext, version: ArtifactVersion, evaluationId: string) {
  const id = await semantic(tx, version.scopeId, 'activatedVersion', [version.artifactKey, version.id]);
  if (!id) reject('OUTC1012', 'Rollback target has never been checked and active in this lineage.');
  const event = await recordOf(tx, id, version.scopeId, version.artifactKey, 'activationEvent');
  const approval = await recordOf(tx, event.approvalId, version.scopeId, version.artifactKey, 'approval');
  if (event.versionId !== version.id || event.evaluationId !== evaluationId || event.action !== 'promote' || approval.action !== 'promote' || approval.versionId !== version.id || approval.evaluationId !== evaluationId || !equalsJson(event.previousHead, approval.expectedHead) || event.nextHead.versionId !== version.id || event.nextHead.revision !== event.previousHead.revision + 1) reject('OUTC1002', 'Original activation provenance differs.');
}
export async function commitApproval(tx: OutcomeTransaction, context: ServiceContext, c: ApproveCommand, op: Operation) {
  if (!context.principal.approve) reject('OUTC1012', 'The host principal has no approval capability.');
  const i = c.input, head = await headFor(tx, c.scopeId, c.artifactKey);
  assertHead(head, i.expectedHead);
  const version = await recordOf(tx, i.versionId, c.scopeId, c.artifactKey, 'artifactVersion');
  if (await semantic(tx, c.scopeId, 'evaluation', version.id) !== i.evaluationId) reject('OUTC1011', 'The candidate has no matching retrospective evaluation.');
  const evaluation = await recordOf(tx, i.evaluationId, c.scopeId, c.artifactKey, 'evaluation');
  await checkedEvaluation(tx, context, version, evaluation);
  if (c.at < evaluation.recordedAt) reject('OUTC1001', 'Approval precedes its evaluation.');
  if (i.action === 'promote') {
    assertHead(head, evaluation.expectedHead);
    if (version.parentVersionId !== head.versionId) reject('OUTC1013', 'Approval target parent is stale.');
  } else {
    if (head.versionId === version.id) reject('OUTC1013', 'Rollback target is already active.');
    await previouslyActive(tx, context, version, evaluation.id);
  }
  const approval = await seal('approval', c.scopeId, c.artifactKey, c.at, { ...i, requestId: op.id, actorId: context.principal.id, authorityId: context.principal.authorityId, gatePolicyId: evaluation.gatePolicyId });
  await putRecord(tx, approval); return { approvalId: approval.id };
}
export async function commitActivation(tx: OutcomeTransaction, context: ServiceContext, c: PromoteCommand | RollbackCommand, action: 'promote' | 'rollback') {
  const approval = await recordOf(tx, c.input.approvalId, c.scopeId, c.artifactKey, 'approval');
  if (approval.action !== action) reject('OUTC1012', 'An action-specific approval is required.');
  const used = await semantic(tx, c.scopeId, 'activationApproval', approval.id);
  if (used) reject('OUTC1007', `This approval already activated an artifact: ${used}.`);
  const head = await headFor(tx, c.scopeId, c.artifactKey); assertHead(head, approval.expectedHead);
  const version = await recordOf(tx, approval.versionId, c.scopeId, c.artifactKey, 'artifactVersion');
  const evaluation = await recordOf(tx, approval.evaluationId, c.scopeId, c.artifactKey, 'evaluation');
  const registration = await checkedEvaluation(tx, context, version, evaluation);
  if (approval.gatePolicyId !== evaluation.gatePolicyId || c.at < approval.recordedAt) reject('OUTC1012', 'Approval policy or chronology differs.');
  let nextHead;
  if (action === 'promote') nextHead = planPromotion(head, version, evaluation, registration, approval);
  else {
    if (head.versionId === version.id) reject('OUTC1013', 'Rollback target is already active.');
    await previouslyActive(tx, context, version, evaluation.id);
    nextHead = planHeadTransition(head, approval.expectedHead, version.id);
  }
  const event = await seal('activationEvent', c.scopeId, c.artifactKey, c.at, { action, approvalId: approval.id, previousHead: head, nextHead, versionId: version.id, evaluationId: evaluation.id });
  await putRecord(tx, event);
  await tx.put('heads', { id: await keyId(c.scopeId, 'head', c.artifactKey), scopeId: c.scopeId, artifactKey: c.artifactKey, head: nextHead, eventId: event.id });
  await unique(tx, c.scopeId, 'activationApproval', approval.id, event.id);
  const activated = await semantic(tx, c.scopeId, 'activatedVersion', [c.artifactKey, version.id]);
  if (!activated) await unique(tx, c.scopeId, 'activatedVersion', [c.artifactKey, version.id], event.id);
  return { activationEventId: event.id, head: asJson(nextHead) };
}
export async function checkedHead(tx: OutcomeTransaction, context: ServiceContext, artifactKey: string) {
  const row = await tx.get('heads', await keyId(context.scopeId, 'head', artifactKey));
  if (!row || row.head.versionId === null) reject('OUTC1004', 'No checked artifact is active in this exact scope.');
  checkShape<HeadRow>('headRow', row);
  if (row.scopeId !== context.scopeId || row.artifactKey !== artifactKey || !row.eventId) reject('OUTC1002', 'Active head provenance is missing or mismatched.');
  const event = await recordOf(tx, row.eventId, context.scopeId, artifactKey, 'activationEvent');
  const approval = await recordOf(tx, event.approvalId, context.scopeId, artifactKey, 'approval');
  const version = await recordOf(tx, row.head.versionId, context.scopeId, artifactKey, 'artifactVersion');
  const evaluation = await recordOf(tx, event.evaluationId, context.scopeId, artifactKey, 'evaluation');
  const registration = await checkedEvaluation(tx, context, version, evaluation);
  if (!equalsJson(event.nextHead, row.head) || event.versionId !== version.id || approval.versionId !== version.id || approval.evaluationId !== evaluation.id || approval.action !== event.action || approval.gatePolicyId !== evaluation.gatePolicyId || !equalsJson(approval.expectedHead, event.previousHead) || event.nextHead.revision !== event.previousHead.revision + 1) reject('OUTC1002', 'Active head provenance does not reproduce.');
  if (event.action === 'promote') planPromotion(event.previousHead, version, evaluation, registration, approval);
  else await previouslyActive(tx, context, version, evaluation.id);
  return { payload: version.payload, versionId: version.id, evaluationId: evaluation.id, activationEventId: event.id, head: asJson(row.head) };
}
