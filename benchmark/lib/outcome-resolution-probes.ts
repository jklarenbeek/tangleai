/** Observed refusal and recovery counters accompany the clean quality row. */
import { createMemoryOutcomeStore, createOutcomeService, outcomeRevision, scopeIdOf } from '@tangleai/outcomes';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { resultId, resultValue } from './outcome-runtime.ts';
import { probe } from './outcome-conformance.ts';
import type { Result, Source } from '@tangleai/outcomes';
const code = (r: Result) => r.ok ? 'accepted' : r.issues[0].code;
export async function measureResolutionSafety() {
  const base = await createDirectionDeltaAdapter(); let scorerFails = false, memoryWrites = 0, armed = false;
  const store = createMemoryOutcomeStore({ applyProbe(step) {
    if (armed && step === 'put:memories' && ++memoryWrites === 2) { armed = false; throw Error('registered projection failure'); }
  } });
  const scope = { namespace: 'outcome-benchmark', domain: 'direction-delta', subject: 'resolution-adversaries' }, scopeId = await scopeIdOf(scope);
  const revision = await outcomeRevision({ measurement: 'resolution-adversaries/v1' }), sources = new Map<string, Source>();
  const service = await createOutcomeService({ store, scope, adapters: [{ ...base, score(output, resolution) { if (scorerFails) throw Error('registered scorer failure'); return base.score(output, resolution); } }],
    resolver: { revision, async resolve(ref) { return sources.get(ref.sourceId); } },
    principal: { id: 'fixture', authorityId: revision, approve: true, reconcile: true },
    authorizeMemoryIds: async ids => ({ allowed: !ids.includes('forbidden'), authorizationId: revision }),
  });
  const at = '2026-01-01T00:00:00.000Z', observedAt = '2026-01-02T00:00:00.000Z', lateAt = '2026-01-03T00:00:00.000Z';
  const command = (requestKey: string, input: object, time = lateAt) => ({ scopeId, artifactKey: 'policy', requestKey, at: time, input });
  const input = (decisionKey: string) => ({ decisionKey, adapter: base.identity, input: { base: 0 }, output: { predicted: 0 }, decidedAt: at, cutoffAt: at, expectedResolutionAt: observedAt, memoryIds: ['a', 'b'], configuration: { kind: 'scripted', revision }, usedVersionId: null, staticPayload: base.staticPayload });
  const decisionId = resultId(await service.create(command('c', input('late'), at)), 'decisionId');
  const bytes = { sourceId: 'late', decisionId, scopeId, subject: scope.subject, issuer: 'registered-fixture', observedAt, payload: { actual: 0 } };
  const source = { ...bytes, digest: await outcomeRevision(bytes) }; sources.set(source.sourceId, source);
  const resolutionId = resultId(await service.resolve(command('r', { decisionId, evidence: [{ sourceId: source.sourceId, digest: source.digest }], receivedAt: lateAt })), 'resolutionId');
  const inspect = (id: string) => service.inspect({ scopeId, artifactKey: 'policy', input: { id } });
  const late = resultValue(await inspect(resolutionId)).late;
  scorerFails = true; const scoreCommand = command('s', { resolutionId }), scorerFailure = code(await service.score(scoreCommand)); scorerFails = false;
  const scoreId = resultId(await service.score(scoreCommand), 'scoreId');
  for (const id of ['a', 'b']) await store.memories.put({ id, kind: 'fact', text: id, evidence: 'fixture', tags: [], at, confidence: 0.5 });
  const project = command('p', { scoreId }); armed = true;
  const projectionFailure = code(await service.project(project));
  const afterRollback = [(await store.memories.get('a'))!.confidence!, (await store.memories.get('b'))!.confidence!];
  const rolledBackReceipts = await persistenceFor(store).transaction(tx => tx.query('records', { scopeId, kind: 'projectionReceipt' }));
  resultValue(await service.project(project)); const replay = await service.project(project);
  const afterRetry = [(await store.memories.get('a'))!.confidence!, (await store.memories.get('b'))!.confidence!];
  const refusals: string[] = [];
  for (const mode of ['scope', 'question', 'mutable', 'missing']) {
    const decisionId = resultId(await service.create(command('c:' + mode, input(mode), at)), 'decisionId');
    const data = { ...bytes, sourceId: mode, decisionId: mode === 'question' ? 'a'.repeat(64) : decisionId, scopeId: mode === 'scope' ? 'b'.repeat(64) : scopeId };
    const source = { ...data, digest: await outcomeRevision(data) }; if (mode !== 'missing') sources.set(mode, source); if (mode === 'mutable') source.payload = { actual: 1 };
    refusals.push(code(await service.resolve(command('r:' + mode, { decisionId, evidence: [{ sourceId: mode, digest: source.digest }], receivedAt: lateAt }))));
  }
  const unauthorized = code(await service.create(command('unauthorized', { ...input('unauthorized'), memoryIds: ['forbidden'] }, at)));
  const parity = [[0, 0], [0, .049], [0, .05], [0, .051], [-.1, -.12], [-.1, .1], [0, -.01]].map(([predicted, actual]) => base.score({ predicted }, { actual }).outcome);
  return [
    probe('resolution-production-scorer-parity', ['success', 'success', 'partial', 'partial', 'success', 'failure', 'failure'], parity, 'resolution'),
    probe('resolution-late-and-scorer-recovery', [true, 'OUTC1015', 'resolution', 'score'], [late, scorerFailure, resultValue(await inspect(resolutionId)).kind, resultValue(await inspect(scoreId)).kind], 'resolution'),
    probe('projection-rollback', ['OUTC1015', .5, .5, 0], [projectionFailure, ...afterRollback, rolledBackReceipts.length], 'resolution'),
    probe('projection-retry-and-replay', [.65, .65, true, 0], [...afterRetry, replay.ok && replay.replayed, replay.ok ? replay.writes : -1], 'resolution'),
    probe('resolution-refusal-census', ['OUTC1003', 'OUTC1003', 'OUTC1006', 'OUTC1006', 'OUTC1003'], [...refusals, unauthorized], 'resolution'),
  ];
}
