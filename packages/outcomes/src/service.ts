/** Explicit lifecycle commands. External host work runs outside transactions. */
import { historyPage, inspectRecord } from './history.ts';
import { equalsJson } from '@jarenjs/core/object';
import { checkShape, checkTime } from './schema.ts';
import { failure, reject } from './errors.ts';
import { keyId } from './identity.ts';
import { beginOperation, finishOperation } from './operations.ts';
import { readRecord, putRecord, unique, headFor } from './persistence.ts';
import { makeContext, asJson, recordOf, requireNew, seal } from './service-context.ts';
import { prepareResolution, commitResolution } from './resolution.ts';
import { prepareScore, commitScore } from './scoring.ts';
import { prepareProjection, commitProjection } from './projection.ts';
import { reflectionContext, commitReflection } from './refinement.ts';
import { prepareEvaluation, commitEvaluation } from './evaluation.ts';
import { commitApproval, commitActivation, checkedHead } from './promotion.ts';
import { modelProposal, prepareReconciliation, commitReconciliation } from './proposal-operation.ts';
import type { OutcomeServiceOptions } from './service-context.ts';
import type { OperationCommand } from './operations.ts';
import type { OutcomeTransaction, OutcomeStore } from './store.ts';
import type { CreateCommand, ResolveCommand, ScoreCommand, ProjectCommand, InspectCommand, ReflectCommand, EvaluateCommand, ApproveCommand, PromoteCommand, RollbackCommand, InjectCommand, ReconcileCommand, HistoryCommand, PreparedModelOutput, Operation, Json, Result } from './outcomes.contracts.gen.ts';

export type { OutcomeServiceOptions } from './service-context.ts';
const liveReflections = new WeakMap<OutcomeStore, Set<string>>();
export async function createOutcomeService(options: OutcomeServiceOptions) {
  const context = await makeContext(options);
  function boundary<T extends { scopeId: string }>(shape: string, value: unknown): T {
    const c = checkShape<T>(shape, value);
    if (c.scopeId !== context.scopeId) reject('OUTC1003', 'Request scope differs from its host.');
    context.atomic();
    return c;
  }
  async function mutate<C extends OperationCommand, P>(name: string, raw: unknown, prepare: (c: C, op: Operation) => Promise<P>, commit: (tx: OutcomeTransaction, c: C, data: P) => Promise<Json>): Promise<Result> {
    try {
      const c = boundary<C>(`${name}Command`, raw); checkTime(c.at);
      if ((name === 'approve' && !context.principal.approve) || (name === 'reconcile' && !context.principal.reconcile)) reject('OUTC1012', 'The host principal lacks this capability.');
      const reservation = await beginOperation(context.store, name, c);
      if (reservation.replay) return reservation.replay;
      let data: P;
      try { data = await prepare(c, reservation.operation); }
      catch (error) { return await finishOperation(context.store, reservation.operation, c.at, async () => { throw error; }); }
      return await finishOperation(context.store, reservation.operation, c.at, tx => commit(tx, c, data));
    } catch (error) { return failure(error); }
  }
  return Object.freeze({
    scopeId: context.scopeId,
    policyId: context.policyId,
    gatePolicyId: context.gatePolicyId,
    create: (raw: unknown) => mutate<CreateCommand, void>('create', raw, async c => {
      const i = c.input;
      checkTime(i.cutoffAt); checkTime(i.decidedAt); if (i.expectedResolutionAt !== null) checkTime(i.expectedResolutionAt);
      if (i.cutoffAt > i.decidedAt || c.at < i.decidedAt || (i.expectedResolutionAt !== null && i.expectedResolutionAt < i.decidedAt)) reject('OUTC1001', 'Decision chronology is invalid.');
      const { domain } = context.adapter(i.adapter);
      domain.input(i.input); domain.output(i.output); domain.artifact(i.staticPayload);
      await context.configuration(i.configuration);
      await context.authorization([...new Set(i.memoryIds)].sort());
    }, async (tx, c) => {
      const i = c.input, { adapter, domain } = context.adapter(i.adapter);
      await requireNew(tx, c.scopeId, 'decision', i.decisionKey);
      if (!equalsJson(domain.artifact(i.staticPayload), domain.artifact(adapter.staticPayload))) reject('OUTC1008', 'Static baseline differs from the registered adapter.');
      if (i.usedVersionId !== null) {
        const checked = await checkedHead(tx, context, c.artifactKey);
        const version = await recordOf(tx, i.usedVersionId, c.scopeId, c.artifactKey, 'artifactVersion');
        const head = await headFor(tx, c.scopeId, c.artifactKey);
        if (head.versionId !== version.id || !equalsJson(version.adapter, i.adapter)) reject('OUTC1013', 'Decision did not use the current checked artifact.');
        if (!equalsJson(domain.output(adapter.interpret(i.input, checked.payload)), i.output)) reject('OUTC1008', 'Decision output does not reproduce with its checked artifact.');
      }
      const decision = await seal('decision', c.scopeId, c.artifactKey, c.at, { ...i, scope: context.scope });
      await putRecord(tx, decision); await unique(tx, c.scopeId, 'decision', i.decisionKey, decision.id);
      return { decisionId: decision.id };
    }),
    resolve: (raw: unknown) => mutate<ResolveCommand, Awaited<ReturnType<typeof prepareResolution>>>('resolve', raw, c => prepareResolution(context, c), (tx, c, data) => commitResolution(tx, context, c, data)),
    score: (raw: unknown) => mutate<ScoreCommand, Awaited<ReturnType<typeof prepareScore>>>('score', raw, c => prepareScore(context, c), (tx, c, data) => commitScore(tx, context, c, data)),
    project: (raw: unknown) => mutate<ProjectCommand, Awaited<ReturnType<typeof prepareProjection>>>('project', raw, c => prepareProjection(context, c), (tx, c, data) => commitProjection(tx, context, c, data)),
    async reflect(raw: unknown): Promise<Result> {
      let activeId: string | undefined;
      let active = liveReflections.get(context.store);
      if (!active) { active = new Set(); liveReflections.set(context.store, active); }
      try {
        const c = boundary<ReflectCommand>('reflectCommand', raw); checkTime(c.at);
        const requestId = await keyId(c.scopeId, 'request', c.requestKey);
        if (active.has(requestId)) reject('OUTC1019', 'This proposal is already in progress in this host.');
        activeId = requestId; active.add(requestId);
        const reservation = await beginOperation(context.store, 'reflect', c, context.policy);
        if (reservation.replay) return reservation.replay;
        try {
          const saved = reservation.operation.output === null ? null : checkShape<PreparedModelOutput>('preparedModelOutput', reservation.operation.output);
          const data = await reflectionContext(context, c, saved?.head);
          const input = c.input.configuration.kind === 'scripted' ? c.input : await modelProposal(context, c, reservation.operation, data);
          return await finishOperation(context.store, reservation.operation, c.at, tx => commitReflection(tx, context, c, reservation.operation, data, input));
        } catch (error) { return await finishOperation(context.store, reservation.operation, c.at, async () => { throw error; }); }
      } catch (error) { return failure(error); }
      finally { if (activeId) active.delete(activeId); }
    },
    evaluate: (raw: unknown) => mutate<EvaluateCommand, Awaited<ReturnType<typeof prepareEvaluation>>>('evaluate', raw, (c, op) => prepareEvaluation(context, c, op), (tx, c, data) => commitEvaluation(tx, context, c, data)),
    approve: (raw: unknown) => mutate<ApproveCommand, Operation>('approve', raw, async (_c, op) => op, (tx, c, op) => commitApproval(tx, context, c, op)),
    promote: (raw: unknown) => mutate<PromoteCommand, void>('promote', raw, async () => {}, (tx, c) => commitActivation(tx, context, c, 'promote')),
    rollback: (raw: unknown) => mutate<RollbackCommand, void>('rollback', raw, async () => {}, (tx, c) => commitActivation(tx, context, c, 'rollback')),
    reconcile: (raw: unknown) => mutate<ReconcileCommand, Awaited<ReturnType<typeof prepareReconciliation>>>('reconcile', raw, c => prepareReconciliation(context, c), (tx, c, data) => commitReconciliation(tx, context, c, data)),
    async injectChecked(raw: unknown): Promise<Result> {
      try {
        const c = boundary<InjectCommand>('injectCommand', raw);
        return { ok: true, value: await context.atomic().transaction(tx => checkedHead(tx, context, c.artifactKey)), writes: 0, replayed: false };
      } catch (error) { return failure(error); }
    },
    async history(raw: unknown): Promise<Result> {
      try {
        const c = boundary<HistoryCommand>('historyCommand', raw);
        return { ok: true, value: asJson(await historyPage(context, c)), writes: 0, replayed: false };
      } catch (error) { return failure(error); }
    },
    async inspect(raw: unknown): Promise<Result> {
      try {
        const c = boundary<InspectCommand>('inspectCommand', raw);
        const value = await inspectRecord(context, c);
        return { ok: true, value: asJson(value), writes: 0, replayed: false };
      } catch (error) { return failure(error); }
    },
  });
}
export type OutcomeService = Awaited<ReturnType<typeof createOutcomeService>>;
