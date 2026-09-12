import assert from 'node:assert/strict';
import { createOutcomeService, createMemoryOutcomeStore, outcomeRevision, scopeIdOf } from '@tangleai/outcomes';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import type { OutcomeServiceOptions, OutcomeAdapter, OutcomeStore, Json, Result, Source, CreateInput } from '@tangleai/outcomes';

export const AT = '2026-01-01T00:00:00.000Z', LATER = '2026-01-02T00:00:00.000Z', LATE = '2026-01-03T00:00:00.000Z';
export const scope = { namespace: 'tests', domain: 'scalar', subject: 'lineage' };
export const scopeId = await scopeIdOf(scope);
export const revision = await outcomeRevision({ fixture: 1 });
export const memory = (id = 'm') => ({ id, kind: 'fact' as const, text: id, tags: ['pin'], evidence: 'independent fixture', at: AT, confidence: 0.5 });
export function value(result: Result): Record<string, Json> {
  assert.ok(result.ok, JSON.stringify(result)); assert.ok(result.value && typeof result.value === 'object' && !Array.isArray(result.value)); return result.value;
}
export function id(result: Result, key: string): string { const found = value(result)[key]; assert.equal(typeof found, 'string'); return found as string; }
export function code(result: Result, expected: string) { assert.equal(result.ok, false, JSON.stringify(result)); if (!result.ok) assert.equal(result.issues[0].code, expected); }
export async function fixture(options: { store?: OutcomeStore; adapter?: OutcomeAdapter; authorize?: OutcomeServiceOptions['authorizeMemoryIds'] } = {}) {
  const store = options.store ?? createMemoryOutcomeStore(), adapter = options.adapter ?? await createDirectionDeltaAdapter();
  const sources = new Map<string, Source>(); let reads = 0;
  const host: OutcomeServiceOptions = {
    store, scope, adapters: [adapter], principal: { id: 'operator', authorityId: revision, approve: true, reconcile: true },
    resolver: { revision, async resolve(ref) { reads++; return sources.get(ref.sourceId); } },
    authorizeMemoryIds: options.authorize ?? (async ids => ({ allowed: !ids.includes('forbidden'), authorizationId: revision })),
  };
  const service = await createOutcomeService(host);
  const command = (key: string, input: object, at = LATER) => ({ scopeId, artifactKey: 'a', requestKey: key, at, input });
  const create = (key: string, changes: Partial<CreateInput> = {}) => service.create(command('create:' + key, {
    decisionKey: key, adapter: adapter.identity, input: { base: 0 }, output: { predicted: 0 },
    decidedAt: AT, cutoffAt: AT, expectedResolutionAt: LATER, memoryIds: ['m'],
    configuration: { kind: 'scripted', revision }, usedVersionId: null, staticPayload: adapter.staticPayload, ...changes,
  }, AT));
  const evidence = async (decisionId: string, changes: Partial<Omit<Source, 'digest'>> = {}) => {
    const data = { sourceId: `source:${decisionId}`, scopeId, subject: scope.subject, issuer: 'host-fixture', observedAt: LATER, payload: { actual: 0 }, decisionId, ...changes };
    const source = { ...data, digest: await outcomeRevision(data) }; sources.set(source.sourceId, source); return { sourceId: source.sourceId, digest: source.digest };
  };
  const resolved = async (key: string, changes: Partial<CreateInput> = {}) => {
    const decisionId = id(await create(key, changes), 'decisionId');
    const ref = await evidence(decisionId);
    const resolutionCommand = command('resolve:' + key, { decisionId, evidence: [ref], receivedAt: LATER });
    const resolutionId = id(await service.resolve(resolutionCommand), 'resolutionId');
    return { decisionId, resolutionId, resolutionCommand, ref };
  };
  const scored = async (key: string, changes: Partial<CreateInput> = {}) => {
    const r = await resolved(key, changes), scoreCommand = command('score:' + key, { resolutionId: r.resolutionId });
    const result = await service.score(scoreCommand), scoreId = id(result, 'scoreId');
    return { ...r, scoreId, scoreCommand, scoreResult: result };
  };
  const inspect = async (recordId: string) => value(await service.inspect({ scopeId, artifactKey: 'a', input: { id: recordId } }));
  return { store, service, host, sources, adapter, command, create, evidence, resolved, scored, inspect, reads: () => reads };
}
