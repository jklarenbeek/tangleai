/** Keyless public lifecycle walkthrough. Optional --db persists replay receipts. */
import { pathToFileURL } from 'node:url';
import { createMemoryOutcomeStore, createOutcomeService, outcomeRevision } from '@tangleai/outcomes';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import type { OutcomeStore, Result, Json, Source, EvaluationSlot, Head } from '@tangleai/outcomes';

export async function runOutcomeExample(store: OutcomeStore = createMemoryOutcomeStore()) {
  const at = '2026-09-01T00:00:00.000Z', later = '2026-09-02T00:00:00.000Z';
  const revision = await outcomeRevision({ example: 'outcomes/v1' });
  let writes = 0, sourceReads = 0, replayed = 0, requests = 0;
  const ids: string[] = [];
  const value = (result: Result): Record<string, Json> => {
    if (!result.ok) throw Error(JSON.stringify(result));
    writes += result.writes; requests++; if (result.replayed) replayed++;
    return result.value as Record<string, Json>;
  };
  const id = (result: Result, key: string) => {
    const found = value(result)[key]; if (typeof found !== 'string') throw Error(`Missing ${key}`); ids.push(found); return found;
  };
  for (const adapter of [await createDirectionDeltaAdapter(), await createExactMatchAdapter()]) {
    const numeric = adapter.identity.id.startsWith('direction-delta/');
    const scope = { namespace: 'outcomes-example', domain: adapter.identity.id, subject: 'walkthrough' };
    const sources = new Map<string, Source>(), slots = new Map<string, EvaluationSlot>();
    const service = await createOutcomeService({
      store, scope, adapters: [adapter],
      principal: { id: 'example-host', authorityId: revision, approve: true, reconcile: true },
      resolver: { revision, async resolve(reference) { sourceReads++; return sources.get(reference.sourceId); } },
      authorizeMemoryIds: async () => ({ allowed: true, authorizationId: revision }),
      evaluationSlot: async slotId => slots.get(slotId),
    });
    const scopeId = service.scopeId, artifactKey = 'policy';
    const command = (requestKey: string, input: object, time = later) => ({ scopeId, artifactKey, requestKey, at: time, input });
    const query = (input: object) => ({ scopeId, artifactKey, input });
    const memoryId = scope.domain + ':fact';
    if (!await store.memories.get(memoryId)) {
      await store.memories.put({ id: memoryId, kind: 'fact', text: 'Independent training observation', tags: [], evidence: 'example host', at, confidence: 0.5 }); writes++;
    }
    const input: Json = numeric ? { base: 0 } : { token: 'training:one' };
    const actual: Json = numeric ? { actual: 0.06 } : { label: 'yes' };
    const decisionId = id(await service.create(command('decision', {
      decisionKey: 'training', adapter: adapter.identity, input, output: adapter.interpret(input, adapter.staticPayload),
      decidedAt: at, cutoffAt: at, expectedResolutionAt: later, memoryIds: [memoryId, memoryId, 'absent:' + memoryId],
      configuration: { kind: 'scripted', revision }, usedVersionId: null, staticPayload: adapter.staticPayload,
    }, at)), 'decisionId');
    const sourceBytes = { sourceId: 'training-source', decisionId, scopeId, subject: scope.subject, issuer: 'example-host', observedAt: later, payload: actual };
    const source = { ...sourceBytes, digest: await outcomeRevision(sourceBytes) }; sources.set(source.sourceId, source);
    const resolutionId = id(await service.resolve(command('resolution', { decisionId, evidence: [{ sourceId: source.sourceId, digest: source.digest }], receivedAt: later })), 'resolutionId');
    const scoreId = id(await service.score(command('score', { resolutionId })), 'scoreId');
    id(await service.project(command('projection', { scoreId })), 'projectionReceiptId');
    let head: Head = { versionId: null, revision: 0 };
    const active: Array<{ versionId: string; evaluationId: string }> = [];
    for (let step = 1; step <= 2; step++) {
      const payload = numeric ? { offset: step === 1 ? 0.06 : 0.12 } : { fallbackLabel: step === 1 ? 'unknown' : 'no', rules: [{ prefix: 'accept:', label: 'yes' }] };
      const versionId = id(await service.reflect(command('reflect:' + step, {
        mode: step === 1 ? 'create' : 'evolve', scoreIds: [scoreId], parentVersionId: head.versionId,
        payload: step === 1 ? payload : null, patch: step === 1 ? [] : [{ op: 'replace', path: '', value: payload }],
        text: 'Scripted example candidate; independent held-out evaluation follows.', citations: [scoreId], configuration: { kind: 'scripted', revision },
      })), 'versionId');
      const slotId = 'held:' + step, cases = [];
      for (let i = 1; i <= 4; i++) {
        const caseId = `${slotId}:${i}`, heldInput: Json = numeric ? { base: 100 + step * 10 + i } : { token: `${i === 4 ? 'reject' : 'accept'}:${caseId}` };
        const heldOutcome: Json = numeric ? { actual: 100 + step * 10 + i + (step === 1 ? 0.06 : 0.12) } : { label: i === 4 ? 'no' : 'yes' };
        const bytes = { sourceId: caseId, decisionId: null, scopeId, subject: scope.subject, issuer: 'example-host', observedAt: later, payload: heldOutcome };
        const source = { ...bytes, digest: await outcomeRevision(bytes) }; sources.set(caseId, source);
        cases.push({ id: caseId, domain: scope.domain, input: heldInput, source });
      }
      slots.set(slotId, { slotId, versionId, expectedHead: head, trainingScoreIds: [scoreId], cases, evaluatorRevision: revision, gatePolicyId: service.gatePolicyId, maxPhysicalRequests: 0, maxCost: null });
      const evaluationId = id(await service.evaluate(command('evaluate:' + step, { versionId, slotId })), 'evaluationId');
      const approvalId = id(await service.approve(command('approve:' + step, { action: 'promote', versionId, evaluationId, expectedHead: head, reason: 'Host reviewed this independent fixture evaluation.' })), 'approvalId');
      head = value(await service.promote(command('promote:' + step, { approvalId }))).head as unknown as Head;
      active.push({ versionId, evaluationId });
    }
    const approvalId = id(await service.approve(command('approve:restore', { action: 'rollback', ...active[0], expectedHead: head, reason: 'Explicit example restoration.' })), 'approvalId');
    head = value(await service.rollback(command('restore', { approvalId }))).head as unknown as Head;
    const injected = value(await service.injectChecked(query({})));
    if (injected.versionId !== active[0].versionId || head.revision !== 3) throw Error('Checked restoration differs.');
    value(await service.inspect(query({ id: active[1].versionId, includeLineage: true })));
    value(await service.history(query({ pageSize: 50 })));
    const denied = await createOutcomeService({ store, scope, adapters: [adapter], resolver: { revision, async resolve() { return undefined; } }, authorizeMemoryIds: async () => ({ allowed: false, authorizationId: revision }) });
    const refusal = await denied.approve(command('forged-approval', { action: 'promote', ...active[0], expectedHead: head, reason: 'Caller cannot grant itself authority.' }));
    if (refusal.ok || refusal.issues[0].code !== 'OUTC1012') throw Error('Authority refusal differs.');
  }
  return { domains: 2, writes, sourceReads, requests, replayed, physicalRequests: 0, ids, refusal: 'OUTC1012' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--db')) throw Error('Usage: node examples/outcomes.ts [--db path]');
  const db = args[1] ? await openTangleDb({ path: args[1] }) : undefined;
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('This example forbids network access.'); };
  try { console.log(JSON.stringify(await runOutcomeExample(db ? createOutcomeStore(db) : undefined), null, 2)); }
  finally { globalThis.fetch = fetchBefore; await db?.close(); }
}
