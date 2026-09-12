import { createOutcomeService, outcomeRevision } from '@tangleai/outcomes';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { fixture, id, value, revision, LATER, LATE, scope, scopeId } from './fixtures.ts';
import type { OutcomeStore, Json, EvaluationSlot, Head, ReflectInput, OutcomeServiceOptions } from '@tangleai/outcomes';

export async function lifecycleFixture(options: { store?: OutcomeStore; host?: Partial<OutcomeServiceOptions> } = {}) {
  const f = await fixture({ store: options.store, adapter: await createExactMatchAdapter() });
  const slots = new Map<string, EvaluationSlot>(); let deliveries = 0;
  const host: OutcomeServiceOptions = { ...f.host, evaluationSlot: async slotId => { deliveries++; return slots.get(slotId); }, ...options.host };
  const service = await createOutcomeService(host);
  const decisionId = id(await f.create('training', { input: { token: 'training:one' }, output: { label: 'unknown' }, memoryIds: [] }), 'decisionId');
  const ref = await f.evidence(decisionId, { payload: { label: 'yes' } });
  const resolutionId = id(await service.resolve(f.command('resolve-training', { decisionId, evidence: [ref], receivedAt: LATER })), 'resolutionId');
  const scoreId = id(await service.score(f.command('score-training', { resolutionId })), 'scoreId');
  const input = (changes: Partial<ReflectInput> = {}): ReflectInput => ({ mode: 'create', scoreIds: [scoreId], parentVersionId: null, payload: { fallbackLabel: 'unknown', rules: [{ prefix: 'accept:', label: 'yes' }] }, patch: [], text: 'Use the independently scored training case to propose a bounded prefix rule.', citations: [scoreId], configuration: { kind: 'scripted', revision }, ...changes });
  const stage = async (key = 'root', changes: Partial<ReflectInput> = {}) => {
    const command = f.command('reflect:' + key, input(changes)); const result = await service.reflect(command);
    return { versionId: id(result, 'versionId'), reflectionId: id(result, 'reflectionId'), command, result };
  };
  const register = async (versionId: string, slotId = 'slot', changes: Partial<EvaluationSlot> = {}) => {
    const v = await f.inspect(versionId), reflection = await f.inspect(v.reflectionId as string);
    const cases = [];
    for (let i = 1; i <= 4; i++) {
      const caseId = `${slotId}/held-${i}`, sourceData = { sourceId: caseId, decisionId: null, scopeId, subject: scope.subject, issuer: 'fixture', observedAt: LATER, payload: { label: i === 4 ? 'no' : 'yes' } };
      const source = { ...sourceData, digest: await outcomeRevision(sourceData) }; f.sources.set(caseId, source);
      cases.push({ id: caseId, domain: scope.domain, input: { token: `${i === 4 ? 'reject' : 'accept'}:${slotId}:${i}` }, source });
    }
    const slot: EvaluationSlot = { slotId, versionId, expectedHead: v.expectedHead as unknown as Head, trainingScoreIds: reflection.scoreIds as string[], cases, evaluatorRevision: revision, gatePolicyId: service.gatePolicyId, maxPhysicalRequests: 0, maxCost: null, ...changes };
    slots.set(slotId, slot); return slot;
  };
  const evaluate = async (versionId: string, slotId = 'slot') => {
    await register(versionId, slotId); const command = f.command('evaluate:' + slotId, { versionId, slotId });
    const result = await service.evaluate(command); return { evaluationId: id(result, 'evaluationId'), result, command };
  };
  const approve = async (versionId: string, evaluationId: string, head: Head, key = 'approval', action: 'promote' | 'rollback' = 'promote') => {
    const command = f.command(key, { action, versionId, evaluationId, expectedHead: head, reason: 'Reviewed independent paired evidence.' });
    return { approvalId: id(await service.approve(command), 'approvalId'), command };
  };
  const root = async () => {
    const staged = await stage(), checked = await evaluate(staged.versionId), approval = await approve(staged.versionId, checked.evaluationId, { versionId: null, revision: 0 });
    const command = f.command('promote-root', { approvalId: approval.approvalId });
    const result = await service.promote(command); return { ...staged, ...checked, ...approval, activation: result, activationCommand: command, head: value(result).head as unknown as Head };
  };
  return { ...f, service, host, slots, scoreId, stage, register, evaluate, approve, root, input, deliveries: () => deliveries };
}
