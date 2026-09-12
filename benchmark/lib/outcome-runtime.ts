/** The measured row executes public lifecycle methods against registered cases. */
import { createOutcomeService, createMemoryOutcomeStore, createOutcomeStoreAdapter, outcomeRevision, scopeIdOf } from '@tangleai/outcomes';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { emptyCounts, finalizeRow, probe } from './outcome-conformance.ts';
import type { OutcomeFixtures } from './outcome-fixtures.ts';
import type { Source, Result, Json, OutcomeServiceOptions, OutcomeService, EvaluationSlot, Head, OutcomeStore } from '@tangleai/outcomes';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { Row, Trace } from './outcome-conformance.types.ts';

export function resultValue(result: Result): { [key: string]: Json } {
  if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw Error(`Outcome measurement refused: ${JSON.stringify(result)}`);
  return result.value;
}
export function resultId(result: Result, name: string): string {
  const id = resultValue(result)[name]; if (typeof id !== 'string') throw Error(`Missing ${name}`); return id;
}
export function measuredStore(base: OutcomeStore = createMemoryOutcomeStore()) {
  const owner = persistenceFor(base); let writes = 0;
  const store = createOutcomeStoreAdapter({ async transaction(task) {
    let changes = 0;
    const result = await owner.transaction(tx => task({ ...tx,
      async put(table, row) { await tx.put(table, row); changes++; },
      async delete(table, id) { await tx.delete(table, id); changes++; },
    }));
    writes += changes; return result;
  } });
  return { store, writes: () => writes, owner: persistenceFor(store) };
}
export type OutcomeReplayMode = 'integrated-static' | 'checked-scripted' | 'projection-disabled' | 'proposal-only';
export type OutcomeApi = Pick<OutcomeService, 'create' | 'resolve' | 'score' | 'project' | 'reflect' | 'evaluate' | 'approve' | 'promote' | 'rollback' | 'injectChecked' | 'inspect'>;
export async function measureOutcomeReplay(f: OutcomeFixtures, options: { mode?: OutcomeReplayMode; store?: OutcomeStore; serviceFactory?: (host: OutcomeServiceOptions) => Promise<OutcomeApi> } = {}): Promise<{ row: Row; trace: Trace }> {
  const mode = options.mode ?? 'integrated-static', checked = mode === 'checked-scripted' || mode === 'projection-disabled';
  const row: Row = { id: mode, status: 'measured', evidence: 'scripted', reason: null, cases: [], counts: emptyCounts(), utility: null, conditionalUtility: null, cost: null, usageKnown: false, probes: [] };
  const measured = measuredStore(options.store), sources = new Map<string, Source>(), repeats: Array<() => Promise<Result>> = [];
  let resolverReads = 0, seedWrites = 0;
  const revision = await outcomeRevision({ registrationId: f.manifest.registrationId, configuration: 'registered-scripted-replay/v1' });
  const adapters = [await createDirectionDeltaAdapter(), await createExactMatchAdapter()];
  for (const adapter of adapters) {
    const domain = adapter.identity.id.split('/')[0] as 'direction-delta' | 'exact-match', scope = { namespace: 'outcome-benchmark', domain, subject: 'registered-replay' }, scopeId = await scopeIdOf(scope);
    const slots = new Map<string, EvaluationSlot>();
    const host: OutcomeServiceOptions = {
      store: measured.store, scope, adapters: [adapter],
      principal: { id: 'fixture-operator', authorityId: revision, approve: true, reconcile: true },
      resolver: { revision, async resolve(ref) { resolverReads++; return sources.get(ref.sourceId); } },
      authorizeMemoryIds: async () => ({ allowed: true, authorizationId: revision }),
      evaluationSlot: async slotId => slots.get(slotId),
    };
    const direct = await createOutcomeService(host), service = options.serviceFactory ? await options.serviceFactory(host) : direct;
    const command = (requestKey: string, input: object, at: string) => ({ scopeId, artifactKey: 'policy', requestKey, at, input });
    let head: Head = { versionId: null, revision: 0 }, payload = adapter.staticPayload;
    const activeVersions: Array<{ versionId: string; evaluationId: string }> = [];
    for (let round = 1; round <= 4; round++) {
      const pending: Array<{ c: typeof f.quality[number]; decisionId: string }> = [];
      const scoreIds: string[] = [];
      if (head.versionId !== null) {
        const current = resultValue(await service.injectChecked({ scopeId, artifactKey: 'policy', input: {} }));
        payload = current.payload; head = current.head as unknown as Head;
      }
      for (const c of f.quality.filter(v => v.domain === domain && v.round === round)) {
        await measured.store.memories.put({ id: c.id, kind: 'fact', text: c.id, tags: [], evidence: 'registered replay source', at: c.decidedAt, confidence: 0.5 }); seedWrites++;
        const command = { scopeId, artifactKey: 'policy', requestKey: 'create:' + c.id, at: c.decidedAt, input: {
          decisionKey: c.id, adapter: adapter.identity, input: c.input, output: adapter.interpret(c.input, payload),
          decidedAt: c.decidedAt, cutoffAt: c.decidedAt, expectedResolutionAt: c.observedAt,
          memoryIds: [c.id, c.id, 'missing:' + c.id], configuration: { kind: 'scripted', revision }, usedVersionId: head.versionId, staticPayload: adapter.staticPayload,
        } };
        const invoke = () => service.create(command); const decisionId = resultId(await invoke(), 'decisionId'); repeats.push(invoke); pending.push({ c, decisionId });
      }
      // Deliver independently registered outcomes only after all decisions in this round exist.
      for (const { c, decisionId } of pending) {
        if (c.outcome === null) { row.cases.push({ id: c.id, domain, round, available: false, outcome: null, utility: null, status: 'pending', versionId: head.versionId }); continue; }
        const sourceBytes = { sourceId: 'source:' + c.id, decisionId, scopeId, subject: scope.subject, issuer: 'registered-fixture', observedAt: c.observedAt, payload: c.outcome };
        const source = { ...sourceBytes, digest: await outcomeRevision(sourceBytes) }; sources.set(source.sourceId, source);
        const resolve = () => service.resolve({ scopeId, artifactKey: 'policy', requestKey: 'resolve:' + c.id, at: c.observedAt, input: { decisionId, evidence: [{ sourceId: source.sourceId, digest: source.digest }], receivedAt: c.observedAt } });
        const resolutionId = resultId(await resolve(), 'resolutionId'); repeats.push(resolve);
        const score = () => service.score({ scopeId, artifactKey: 'policy', requestKey: 'score:' + c.id, at: c.observedAt, input: { resolutionId } });
        const scoreId = resultId(await score(), 'scoreId'); repeats.push(score); scoreIds.push(scoreId);
        const record = resultValue(await service.inspect({ scopeId, artifactKey: 'policy', input: { id: scoreId } }));
        if (record.outcome !== 'success' && record.outcome !== 'partial' && record.outcome !== 'failure') throw Error('Invalid measured score');
        if (typeof record.utility !== 'number') throw Error('Missing measured utility');
        row.cases.push({ id: c.id, domain, round, available: true, outcome: record.outcome, utility: record.utility, status: 'scored', versionId: head.versionId });
        if (mode === 'projection-disabled') continue;
        const project = () => service.project({ scopeId, artifactKey: 'policy', requestKey: 'project:' + c.id, at: c.observedAt, input: { scoreId } });
        const projection = resultValue(await project()); repeats.push(project);
        row.counts.projectionApplied += Number(projection.applied); row.counts.projectionMissing += Number(projection.missing); row.counts.projectionChanged += Number(projection.changedMemoryWrites);
      }
      if (mode === 'integrated-static' || round === 4) continue;
      const candidate = f.lifecycle.candidates[domain][round - 1], at = pending[0].c.observedAt;
      const reflectionCommand = command(`reflect:${domain}:${round}`, {
        mode: head.versionId === null ? 'create' : 'evolve', scoreIds, parentVersionId: head.versionId,
        payload: head.versionId === null ? candidate : null, patch: head.versionId === null ? [] : [{ op: 'replace', path: '', value: candidate }],
        text: `Registered scripted candidate ${round} for ${domain}; training scores only.`, citations: scoreIds, configuration: { kind: 'scripted', revision },
      }, at);
      const reflect = () => service.reflect(reflectionCommand);
      const versionId = resultId(await reflect(), 'versionId'); repeats.push(reflect); row.counts.scriptedCalls++;
      if (!checked) continue;
      const slotId = `${domain}/held-${round}`;
      const cases = [];
      for (const held of f.held.filter(c => c.domain === domain && c.slot === round)) {
        const data = { sourceId: held.id, decisionId: null, scopeId, subject: scope.subject, issuer: 'registered-fixture', observedAt: at, payload: held.outcome };
        const source = { ...data, digest: await outcomeRevision(data) }; sources.set(source.sourceId, source);
        cases.push({ id: held.id, domain, input: held.input, source });
      }
      slots.set(slotId, { slotId, versionId, expectedHead: { ...head }, trainingScoreIds: [...scoreIds].sort(), cases, evaluatorRevision: revision, gatePolicyId: direct.gatePolicyId, maxPhysicalRequests: 0, maxCost: null });
      const evaluate = () => service.evaluate(command(`evaluate:${slotId}`, { versionId, slotId }, at));
      const evaluated = await evaluate(); repeats.push(evaluate);
      if (resultValue(evaluated).eligible !== true) { row.counts.refused++; continue; }
      const evaluationId = resultId(evaluated, 'evaluationId'), expectedHead = { ...head };
      const approve = () => service.approve(command(`approve:${slotId}`, { action: 'promote', versionId, evaluationId, expectedHead, reason: 'Fixture host explicitly approves the independently evaluated candidate.' }, at));
      const approvalId = resultId(await approve(), 'approvalId'); repeats.push(approve);
      const promote = () => service.promote(command(`promote:${slotId}`, { approvalId }, at));
      head = resultValue(await promote()).head as unknown as Head; repeats.push(promote); activeVersions.push({ versionId, evaluationId });
    }
    if (checked && activeVersions.length > 1) {
      const target = activeVersions[0], expectedHead = { ...head }, at = f.quality.find(c => c.domain === domain && c.round === 4)!.observedAt;
      const approve = () => service.approve(command(`rollback-approval:${domain}`, { action: 'rollback', ...target, expectedHead, reason: 'Fixture restoration of a previously checked and active version.' }, at));
      const approvalId = resultId(await approve(), 'approvalId'); repeats.push(approve);
      const rollback = () => service.rollback(command(`rollback:${domain}`, { approvalId }, at));
      head = resultValue(await rollback()).head as unknown as Head; repeats.push(rollback);
    }
  }
  const before = measured.writes(), reads = resolverReads;
  sources.clear();
  for (const repeat of repeats) { const r = await repeat(); if (!r.ok || !r.replayed || r.writes !== 0) throw Error('Completed lifecycle replay is not free'); row.counts.replayed++; }
  row.probes.push(probe(`${mode}-completed-replay`, [0, 0], [measured.writes() - before, resolverReads - reads], checked ? 'promotion' : 'resolution'));
  if (!checked) row.probes.push(probe(`${mode}-static-parity`, f.quality.map(c => c.expectedStatic), f.quality.map(c => row.cases.find(v => v.id === c.id)!.outcome), 'resolution'));
  row.probes.push(probe(`${mode}-projection-census`, mode === 'projection-disabled' ? [0, 0, 0] : [24, 24, 24], [row.counts.projectionApplied, row.counts.projectionMissing, row.counts.projectionChanged], 'resolution'));
  row.cases.sort((a, b) => f.quality.findIndex(c => c.id === a.id) - f.quality.findIndex(c => c.id === b.id));
  row.counts.writes = measured.writes() - seedWrites;
  const records = await measured.owner.transaction(tx => tx.query('records', {}));
  for (const { record } of records) {
    if (record.kind === 'artifactVersion') { row.counts.versions++; row.counts.retainedBytes += new TextEncoder().encode(canonicalizeJson(record.payload)).length; }
    if (record.kind === 'activationEvent') { if (record.action === 'promote') row.counts.promotions++; else row.counts.rollbacks++; }
  }
  const versionsByArtifact = new Map<string, number>();
  for (const { record } of records) {
    if (record.kind === 'reflection') { row.counts.proposed++; row.counts.reflectionBytes += new TextEncoder().encode(record.text).length; }
    if (record.kind === 'evaluation') { row.counts.evaluated++; if (record.eligible) row.counts.eligible++; }
    if (record.kind === 'approval' && record.action === 'promote') row.counts.approved++;
    if (record.kind === 'artifactVersion') { const key = record.scopeId + ':' + record.artifactKey; versionsByArtifact.set(key, (versionsByArtifact.get(key) ?? 0) + 1); }
    if (record.kind === 'operationReceipt' && record.operation === 'project') { if (record.result.ok) row.counts.projectionReplayed++; else row.counts.projectionFailed++; }
  }
  row.counts.maxVersions = Math.max(0, ...versionsByArtifact.values());
  const memories = await measured.store.memories.list();
  const trace: Trace = { rowId: row.id, records: JSON.parse(JSON.stringify(records.map(r => r.record))), memories: JSON.parse(JSON.stringify(memories)), writes: row.counts.writes, resolverReads };
  return { row: finalizeRow(row), trace };
}
export const measureIntegratedStatic = (f: OutcomeFixtures) => measureOutcomeReplay(f);
