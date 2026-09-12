/** Durable dispatch/output states prevent accidental repetition of remote work. */
import { equalsJson } from '@jarenjs/core/object';
import { checkShape, jsonBytes } from './schema.ts';
import { issue, reject, OutcomeRefusal } from './errors.ts';
import { recordAttempt } from './operations.ts';
import { semantic, unique } from './persistence.ts';
import { recordOf, asJson } from './service-context.ts';
import { verifiedSource } from './resolution.ts';
import type { ServiceContext } from './service-context.ts';
import type { reflectionContext } from './refinement.ts';
import type { OutcomeTransaction } from './store.ts';
import type { Operation, ReflectCommand, ReflectInput, ProposalReply, PreparedModelOutput, DispatchSnapshot, ReconcileCommand, ReconciliationProof } from './outcomes.contracts.gen.ts';

function boundedReply(context: ServiceContext, value: unknown): ProposalReply {
  const reply = checkShape<ProposalReply>('proposalReply', value);
  if (!reply.proposal && !reply.issues.length) reject('OUTC1002', 'The proposer returned neither a proposal nor issues.');
  if (reply.proposal && (new TextEncoder().encode(reply.proposal.text).length > context.policy.maxReflectionBytes || jsonBytes(asJson(reply.proposal)) > context.policy.maxPayloadBytes + context.policy.maxReflectionBytes + context.policy.maxOperations * 128)) {
    return { ...reply, proposal: null, issues: [issue('OUTC1009', 'Returned proposal bytes exceed the retained-output bound.')] };
  }
  return reply;
}
function preparedInput(command: ReflectInput, reply: ProposalReply): ReflectInput {
  return checkShape<ReflectInput>('reflectInput', { ...command, ...(reply.proposal ?? {}) });
}
export async function modelProposal(context: ServiceContext, c: ReflectCommand, op: Operation, data: Awaited<ReturnType<typeof reflectionContext>>): Promise<ReflectInput> {
  if (op.output !== null) {
    const saved = checkShape<PreparedModelOutput>('preparedModelOutput', op.output);
    if (saved.reply.issues.length) throw new OutcomeRefusal(saved.reply.issues);
    return saved.input;
  }
  const identity = await context.configuration(c.input.configuration);
  if (!identity || !context.proposer || context.proposer.identity.identityId !== identity.identityId) reject('OUTC1008', 'A matching registered model proposer is required.');
  if (c.input.payload !== null || c.input.patch.length || c.input.text !== '') reject('OUTC1001', 'Model requests reserve empty payload, patch and text fields for the proposer.');
  const training = data.training.map(t => ({ scoreId: t.score.id, input: t.decision.input, output: t.decision.output, resolvedOutcome: t.resolution.payload, category: t.score.outcome, diagnostics: t.score.diagnostics }));
  const reply = boundedReply(context, await context.proposer.propose(asJson({ mode: c.input.mode, parentPayload: data.previous, schema: data.adapter.schemas.artifact, bounds: context.policy, training }), {
    async onDispatch(requestDigest) {
      checkShape('hash', requestDigest);
      await context.atomic().transaction(async tx => {
        const current = await tx.get('operations', op.id);
        if (!current || current.attempt !== op.attempt || current.state !== 'reserved') reject('OUTC1019', 'This proposal attempt cannot dispatch again.');
        const snapshot: DispatchSnapshot = { input: c.input, head: data.head, previous: data.previous, identity: asJson(identity), requestDigest };
        const eventId = await recordAttempt(tx, current, 'dispatched', c.at, asJson(snapshot));
        await unique(tx, c.scopeId, 'dispatchReceipt', [op.id, op.attempt], eventId);
        await tx.put('operations', { ...current, state: 'dispatched', preparationWrites: current.preparationWrites + 4 });
      });
    },
  }));
  if (reply.identityId !== identity.identityId) reject('OUTC1008', 'Proposer response configuration differs.');
  await context.atomic().transaction(async tx => {
    const current = await tx.get('operations', op.id);
    if (!current || current.attempt !== op.attempt || !['reserved', 'dispatched'].includes(current.state)) reject('OUTC1019', 'Proposal output belongs to a different attempt.');
    const dispatchId = await semantic(tx, c.scopeId, 'dispatchReceipt', [op.id, op.attempt]);
    if (dispatchId) {
      const event = await recordOf(tx, dispatchId, c.scopeId, c.artifactKey, 'attemptEvent');
      const snapshot = checkShape<DispatchSnapshot>('dispatchSnapshot', (event.details as { value: unknown }).value);
      if (snapshot.requestDigest !== reply.requestDigest || reply.physicalRequests !== 1) reject('OUTC1002', 'Proposer output does not bind the dispatched request.');
    } else if (!reply.replayed || reply.physicalRequests !== 0) reject('OUTC1002', 'A purchased proposal requires a durable dispatch receipt.');
    const saved: PreparedModelOutput = { input: preparedInput(c.input, reply), head: data.head, previous: data.previous, reply };
    await recordAttempt(tx, current, 'ready', c.at, asJson(saved));
    await tx.put('operations', { ...current, state: 'ready', output: asJson(saved), preparationWrites: current.preparationWrites + 3 });
  });
  if (reply.issues.length) throw new OutcomeRefusal(reply.issues);
  return preparedInput(c.input, reply);
}
export async function prepareReconciliation(context: ServiceContext, c: ReconcileCommand) {
  if (!context.principal.reconcile) reject('OUTC1012', 'The host principal has no reconciliation capability.');
  const data = await context.atomic().transaction(async tx => {
    const operation = await tx.get('operations', c.input.attemptId);
    if (!operation || operation.scopeId !== c.scopeId || operation.artifactKey !== c.artifactKey) reject('OUTC1003', 'Attempt is unavailable in this scope.');
    if (!['reserved', 'uncertain', 'dispatched'].includes(operation.state)) reject('OUTC1007', 'Only an unfinished reserved or uncertain attempt can be reconciled.');
    const dispatchId = await semantic(tx, c.scopeId, 'dispatchReceipt', [operation.id, operation.attempt]);
    const eventId = dispatchId ?? await semantic(tx, c.scopeId, 'reservationReceipt', [operation.id, operation.attempt]);
    if (!eventId) reject('OUTC1002', 'Attempt has no reservation or dispatch receipt.');
    const event = await recordOf(tx, eventId, c.scopeId, c.artifactKey, 'attemptEvent');
    return { operation, event, snapshot: dispatchId ? checkShape<DispatchSnapshot>('dispatchSnapshot', (event.details as { value: unknown }).value) : null };
  });
  const source = await verifiedSource(context, c.input.evidence, data.event.recordedAt, c.at);
  const proof = checkShape<ReconciliationProof>('reconciliationProof', source.payload);
  if (source.decisionId !== null || proof.attemptId !== data.operation.id || proof.attempt !== data.operation.attempt || proof.inputDigest !== data.operation.inputDigest) reject('OUTC1003', 'Reconciliation evidence binds a different attempt.');
  if (proof.kind === 'retained-output' && (!data.snapshot || proof.reply.requestDigest !== data.snapshot.requestDigest || proof.reply.identityId !== (data.snapshot.identity as { identityId?: unknown }).identityId || proof.reply.physicalRequests !== 1)) reject('OUTC1006', 'Retained output does not bind the dispatched request.');
  return { ...data, source, proof };
}
export async function commitReconciliation(tx: OutcomeTransaction, context: ServiceContext, c: ReconcileCommand, data: Awaited<ReturnType<typeof prepareReconciliation>>) {
  const current = await tx.get('operations', data.operation.id);
  if (!current || current.attempt !== data.operation.attempt || !['reserved', 'uncertain', 'dispatched'].includes(current.state)) reject('OUTC1007', 'The uncertain attempt has already changed.');
  let output = null;
  if (data.proof.kind === 'retained-output') {
    if (!data.snapshot) reject('OUTC1006', 'Retained output requires a dispatched request.');
    const reply = boundedReply(context, data.proof.reply);
    output = asJson({ input: preparedInput(data.snapshot.input, reply), head: data.snapshot.head, previous: data.snapshot.previous, reply });
  }
  const eventId = await recordAttempt(tx, current, 'reconciled', c.at, asJson({ source: data.source, actorId: context.principal.id, authorityId: context.principal.authorityId }));
  // Reconciliation writes are charged to this operation's receipt, not the original proposal twice.
  await tx.put('operations', { ...current, attempt: output === null ? current.attempt + 1 : current.attempt, state: output === null ? 'retryable' : 'ready', output, capacityReserved: output !== null });
  return { attemptId: current.id, reconciliationId: eventId, state: output === null ? 'retryable' : 'ready' };
}
