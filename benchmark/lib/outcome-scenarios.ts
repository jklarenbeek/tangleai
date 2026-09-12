/** Each frozen safety scenario is observed independently of quality averages. */
import { createOutcomeService, createMemoryOutcomeStore, outcomeRevision } from '@tangleai/outcomes';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { probe } from './outcome-conformance.ts';
import { resultId, resultValue } from './outcome-runtime.ts';
import { createInterruptedProposer } from './outcome-model-fixture.ts';
import type { OutcomeFixtures } from './outcome-fixtures.ts';
import type { Json, Source, EvaluationSlot, Head, Result, OutcomeStore, OutcomeServiceOptions } from '@tangleai/outcomes';
import type { Probe } from './outcome-conformance.types.ts';

export async function safetyFixture(numeric = false, store: OutcomeStore = createMemoryOutcomeStore()) {
  const adapter = numeric ? await createDirectionDeltaAdapter() : await createExactMatchAdapter();
  const scope = { namespace: 'outcome-safety', domain: numeric ? 'direction-delta' : 'exact-match', subject: 'registered-scenarios' };
  const revision = await outcomeRevision({ scenario: 'outcomes/v1' }), sources = new Map<string, Source>(), slots = new Map<string, EvaluationSlot>();
  const at = '2026-01-01T00:00:00.000Z', later = '2026-01-02T00:00:00.000Z';
  const host: OutcomeServiceOptions = { store, scope, adapters: [adapter], principal: { id: 'fixture-host', authorityId: revision, approve: true, reconcile: true }, resolver: { revision, async resolve(ref) { return sources.get(ref.sourceId); } }, authorizeMemoryIds: async () => ({ allowed: true, authorizationId: revision }), evaluationSlot: async slot => slots.get(slot) };
  const service = await createOutcomeService(host), scopeId = service.scopeId;
  const command = (requestKey: string, input: object, time = later) => ({ scopeId, artifactKey: 'policy', requestKey, at: time, input });
  const query = (input: object) => ({ scopeId, artifactKey: 'policy', input });
  const create = (name: string, memoryIds: string[] = []) => service.create(command('create:' + name, { decisionKey: name, adapter: adapter.identity, input: numeric ? { base: 0 } : { token: 'training:' + name }, output: numeric ? { predicted: 0 } : { label: 'unknown' }, decidedAt: at, cutoffAt: at, expectedResolutionAt: later, memoryIds, configuration: { kind: 'scripted', revision }, usedVersionId: null, staticPayload: adapter.staticPayload }, at));
  const source = async (decisionId: string | null, name: string, payload: Json = numeric ? { actual: 0 } : { label: 'yes' }, changes: Partial<Source> = {}) => {
    const bytes = { sourceId: name, decisionId, scopeId, subject: scope.subject, issuer: 'fixture-host', observedAt: later, payload, ...changes };
    const { digest: _ignored, ...data } = bytes as Source;
    const value = { ...data, digest: await outcomeRevision(data) }; sources.set(name, value); return { sourceId: name, digest: value.digest };
  };
  const scored = async (name: string, payload?: Json, memoryIds?: string[]) => {
    const decisionId = resultId(await create(name, memoryIds), 'decisionId'), evidence = await source(decisionId, name, payload);
    const resolveCommand = command('resolve:' + name, { decisionId, evidence: [evidence], receivedAt: later });
    const resolutionId = resultId(await service.resolve(resolveCommand), 'resolutionId');
    const scoreResult = await service.score(command('score:' + name, { resolutionId }));
    return { decisionId, resolutionId, scoreId: resultId(scoreResult, 'scoreId'), resolveCommand, scoreResult };
  };
  const training = await scored('training');
  const reflectInput = (payload: Json, head: Head = { versionId: null, revision: 0 }) => ({ mode: head.versionId ? 'evolve' : 'create', scoreIds: [training.scoreId], parentVersionId: head.versionId, payload: head.versionId ? null : payload, patch: head.versionId ? [{ op: 'replace', path: '', value: payload }] : [], text: 'Frozen safety candidate.', citations: [training.scoreId], configuration: { kind: 'scripted', revision } });
  const stage = (name: string, payload: Json, head?: Head) => service.reflect(command('reflect:' + name, reflectInput(payload, head)));
  const evaluate = async (versionId: string, slotId: string) => {
    const version = resultValue(await service.inspect(query({ id: versionId }))), cases = [];
    for (let i = 1; i <= 4; i++) {
      const name = `${slotId}:${i}`; await source(null, name, { label: i === 4 ? 'no' : 'yes' });
      cases.push({ id: name, domain: scope.domain, input: { token: `${i === 4 ? 'reject' : 'accept'}:${name}` }, source: sources.get(name)! });
    }
    slots.set(slotId, { slotId, versionId, expectedHead: version.expectedHead as unknown as Head, trainingScoreIds: [training.scoreId], cases, evaluatorRevision: revision, gatePolicyId: service.gatePolicyId, maxPhysicalRequests: 0, maxCost: null });
    return service.evaluate(command('evaluate:' + slotId, { versionId, slotId }));
  };
  const approve = (name: string, versionId: string, evaluationId: string, expectedHead: Head, action: 'promote' | 'rollback' = 'promote') => service.approve(command('approve:' + name, { action, versionId, evaluationId, expectedHead, reason: 'Explicit fixture review.' }));
  return { host, service, store, scopeId, revision, sources, command, query, create, source, scored, training, reflectInput, stage, evaluate, approve };
}
export async function measureOutcomeScenarios(f: OutcomeFixtures): Promise<Probe[]> {
  const results = new Map<string, { code: string | null; invariant: boolean }>();
  const observe = (id: string, result: Result, invariant = true) => results.set(id, { code: result.ok ? null : result.issues[0].code, invariant });
  let armed = false;
  const n = await safetyFixture(true, createMemoryOutcomeStore({ applyProbe(step) { if (armed && step === 'put:memories') { armed = false; throw Error('projection interrupted'); } } }));
  const pending = resultId(await n.create('pending'), 'decisionId');
  observe('pending-only', await n.service.score(n.command('pending-score', { resolutionId: pending })));
  for (const [category, actual] of [['success', 0], ['partial', .05], ['failure', -.1]] as const) {
    const s = await n.scored(category, { actual });
    observe(category, s.scoreResult, resultValue(await n.service.inspect(n.query({ id: s.scoreId }))).outcome === category);
  }
  for (const mode of ['missing-evidence', 'mutated-evidence', 'wrong-subject', 'model-self-resolution']) {
    const decisionId = resultId(await n.create(mode), 'decisionId');
    const ref = await n.source(decisionId, mode, { actual: 0 }, mode === 'wrong-subject' ? { subject: 'foreign' } : {});
    if (mode === 'missing-evidence' || mode === 'model-self-resolution') n.sources.delete(mode);
    if (mode === 'mutated-evidence') n.sources.get(mode)!.payload = { actual: 1 };
    observe(mode, await n.service.resolve(n.command('resolve:' + mode, { decisionId, evidence: [ref], receivedAt: '2026-01-02T00:00:00.000Z' })));
  }
  observe('duplicate-resolution', await n.service.resolve(n.training.resolveCommand), (await n.service.resolve(n.training.resolveCommand)).ok);
  observe('conflicting-resolution', await n.service.resolve({ ...n.training.resolveCommand, requestKey: 'conflicting' }));
  const lateDecision = resultId(await n.create('late'), 'decisionId'), lateEvidence = await n.source(lateDecision, 'late');
  const late = await n.service.resolve(n.command('late', { decisionId: lateDecision, evidence: [lateEvidence], receivedAt: '2026-01-03T00:00:00.000Z' }, '2026-01-03T00:00:00.000Z'));
  observe('late-resolution', late, resultValue(await n.service.inspect(n.query({ id: resultId(late, 'resolutionId') }))).late === true);
  await n.store.memories.put({ id: 'present', text: 'fact', kind: 'fact', evidence: 'fixture', tags: [], at: '2026-01-01T00:00:00.000Z', confidence: .5 });
  const duplicates = await n.scored('citations', { actual: 0 }, ['present', 'present', 'missing']);
  const projected = await n.service.project(n.command('project-duplicates', { scoreId: duplicates.scoreId }));
  observe('duplicate-citations', projected, resultValue(projected).applied === 1 && (await n.store.memories.get('present'))?.confidence === .65);
  observe('missing-memory', projected, resultValue(projected).missing === 1);
  const crashScore = await n.scored('projection-crash', { actual: 0 }, ['present']); armed = true;
  const crash = await n.service.project(n.command('projection-crash', { scoreId: crashScore.scoreId }));
  observe('projection-crash', crash, (await n.store.memories.get('present'))?.confidence === .65);
  const g = await safetyFixture(), empty: Head = { versionId: null, revision: 0 };
  const good = { fallbackLabel: 'unknown', rules: [{ prefix: 'accept:', label: 'yes' }] }, better = { ...good, fallbackLabel: 'no' };
  const root = resultId(await g.stage('root', good), 'versionId'), evaluationId = resultId(await g.evaluate(root, 'root'), 'evaluationId');
  const unmeasured = resultId(await g.stage('unmeasured', better), 'versionId');
  observe('unmeasured-candidate', await g.approve('unmeasured', unmeasured, g.revision, empty));
  const losing = resultId(await g.stage('losing', { fallbackLabel: 'wrong', rules: [] }), 'versionId'), losingEvaluation = resultId(await g.evaluate(losing, 'losing'), 'evaluationId');
  observe('regressing-candidate', await g.approve('losing', losing, losingEvaluation, empty));
  const approvals = [];
  for (let i = 0; i < 20; i++) approvals.push(resultId(await g.approve('root:' + i, root, evaluationId, empty), 'approvalId'));
  const contenders = await Promise.all(approvals.map((approvalId, i) => g.service.promote(g.command('promote:' + i, { approvalId }))));
  const conflicts = contenders.filter(r => !r.ok); observe('concurrent-promotions', conflicts[0], contenders.filter(r => r.ok).length === 1 && conflicts.length === 19 && conflicts.every(r => !r.ok && r.issues[0].code === 'OUTC1013'));
  const head = { versionId: root, revision: 1 };
  observe('stale-parent', await g.service.reflect(g.command('stale-parent', { ...g.reflectInput(better, head), parentVersionId: unmeasured })));
  observe('cross-scope', await g.service.inspect({ ...g.query({ id: root }), scopeId: g.revision }));
  const denied = await createOutcomeService({ ...g.host, principal: undefined });
  observe('forged-approval', await denied.approve(g.command('forged', { action: 'promote', versionId: root, evaluationId, expectedHead: head, reason: 'Model text cannot authorize.' })));
  const child = resultId(await g.stage('child', better, head), 'versionId'), childEvaluation = resultId(await g.evaluate(child, 'child'), 'evaluationId');
  const childApproval = resultId(await g.approve('child', child, childEvaluation, head), 'approvalId'), staleApproval = resultId(await g.approve('stale-child', child, childEvaluation, head), 'approvalId');
  const activated = await g.service.promote(g.command('promote-child', { approvalId: childApproval }));
  const rollbackApproval = resultId(await g.approve('rollback', root, evaluationId, resultValue(activated).head as unknown as Head, 'rollback'), 'approvalId');
  const rollback = await g.service.rollback(g.command('rollback', { approvalId: rollbackApproval }));
  observe('rollback', rollback, (resultValue(rollback).head as { revision: number }).revision === 3 && resultValue(await g.service.injectChecked(g.query({}))).versionId === root);
  observe('aba-head', await g.service.promote(g.command('aba', { approvalId: staleApproval })));
  const capacity = await safetyFixture(); for (let i = 0; i < 10; i++) resultValue(await capacity.stage('cap:' + i, good));
  observe('version-cap', await capacity.stage('cap:11', good));
  const interrupted = await safetyFixture(), proposer = await createInterruptedProposer();
  const uncertainService = await createOutcomeService({ ...interrupted.host, proposer });
  const uncertainCommand = interrupted.command('uncertain', { ...interrupted.reflectInput(null), text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } });
  const uncertain = await uncertainService.reflect(uncertainCommand), replay = await uncertainService.reflect(uncertainCommand);
  observe('uncertain-dispatch', uncertain, !replay.ok && replay.issues[0].code === 'OUTC1017');
  return f.lifecycle.scenarios.map(s => {
    const observed = results.get(s.id); if (!observed) throw Error(`Unmeasured safety scenario: ${s.id}`);
    return probe('scenario-' + s.id, { code: s.code, invariant: true }, observed, 'complete');
  });
}
