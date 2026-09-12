/** A service binds trusted host capabilities before accepting request JSON. */
import { equalsJson } from '@jarenjs/core/object';
import { DEFAULT_OUTCOME_OPTIONS } from '@tangleai/memory/outcome';
import { checkShape, DEFAULT_OUTCOME_POLICY } from './schema.ts';
import { outcomeRevision, scopeIdOf, sealRecord } from './identity.ts';
import { checkedAdapter } from './domain.ts';
import { reject } from './errors.ts';
import { readRecord, semantic } from './persistence.ts';
import { persistenceFor } from './store.ts';
import { outcomeGatePolicyId } from './evaluation.ts';
import { validateRunIdentity, identityIdOf } from '@tangleai/config';
import type { OutcomeStore, OutcomeTransaction } from './store.ts';
import type { OutcomeAdapter, OutcomeHost, OutcomePrincipal } from './adapters.ts';
import type { AdapterIdentity, ConfidencePolicy, Json, OutcomeRecord, Policy, Configuration } from './outcomes.contracts.gen.ts';

export interface OutcomeServiceOptions extends OutcomeHost {
  store: OutcomeStore;
  policy?: Policy;
  confidencePolicy?: ConfidencePolicy;
}
export const asJson = (value: unknown): Json => checkShape<Json>('json', value);
export async function makeContext(options: OutcomeServiceOptions) {
  const scope = checkShape<OutcomeHost['scope']>('scope', options.scope), scopeId = await scopeIdOf(scope);
  const policy = checkShape<Policy>('policy', options.policy ?? DEFAULT_OUTCOME_POLICY);
  const confidencePolicy = checkShape<ConfidencePolicy>('confidencePolicy', options.confidencePolicy ?? DEFAULT_OUTCOME_OPTIONS);
  if (confidencePolicy.minConfidence > confidencePolicy.maxConfidence) throw new TypeError('Confidence minimum exceeds maximum.');
  const confidencePolicyId = await outcomeRevision(confidencePolicy), policyId = await outcomeRevision(policy);
  const principal = Object.freeze(checkShape<OutcomePrincipal>('principal', options.principal ?? { id: 'unprivileged', authorityId: await outcomeRevision({ authority: 'none' }), approve: false, reconcile: false }));
  const registry = new Map<string, OutcomeAdapter>();
  for (const adapter of options.adapters) {
    const identity = checkShape<AdapterIdentity>('adapterIdentity', adapter.identity);
    for (const key of ['input', 'output', 'resolution', 'artifact'] as const) {
      if (await outcomeRevision(adapter.schemas[key]) !== identity[`${key}Schema`]) throw new TypeError('Adapter schema identity differs.');
    }
    if (registry.has(identity.revision)) throw new TypeError('Duplicate adapter revision.');
    registry.set(identity.revision, adapter);
  }
  const resolverRevision = checkShape<string>('hash', options.resolver.revision);
  return {
    ...options, principal, scope, scopeId, policy, policyId, confidencePolicy, confidencePolicyId, resolverRevision,
    gatePolicyId: await outcomeGatePolicyId(asJson(policy)),
    async configuration(configuration:Configuration) {
      if(configuration.kind==='scripted')return null;
      const identity=options.proposer?.identity.identityId===configuration.identityId?options.proposer.identity:await options.resolveConfiguration?.(configuration.identityId);
      const checked=validateRunIdentity(identity);
      if(!checked.ok)reject('OUTC1008','The model configuration identity is not registered.');
      const {identityId,...payload}=checked.value;
      if(identityId!==configuration.identityId||await identityIdOf(payload)!==identityId)reject('OUTC1008','Model configuration bytes differ from their identity.');
      return checked.value;
    },
    atomic() {
      try { return persistenceFor(options.store); }
      catch { reject('OUTC1018', 'An outcome store must own memory and receipts atomically.'); }
    },
    adapter(identity: AdapterIdentity) {
      const adapter = registry.get(identity.revision);
      if (!adapter || !equalsJson(adapter.identity, identity)) reject('OUTC1008', 'The pinned adapter revision is not registered.');
      return { adapter, domain: checkedAdapter(adapter) };
    },
    async authorization(ids: readonly string[]) {
      const answer = await options.authorizeMemoryIds(ids, scope);
      if (!answer.allowed) reject('OUTC1003', 'The host refused memory citations for this scope.');
      return checkShape<string>('hash', answer.authorizationId);
    },
  };
}
export type ServiceContext = Awaited<ReturnType<typeof makeContext>>;
export async function recordOf<K extends OutcomeRecord['kind']>(tx: OutcomeTransaction, id: string, scopeId: string, artifactKey: string, kind: K): Promise<Extract<OutcomeRecord, { kind: K }>> {
  const record = await readRecord(tx, id, scopeId, artifactKey);
  if (record.kind !== kind) reject('OUTC1005', `This transition requires a ${kind} record.`);
  return record as Extract<OutcomeRecord, { kind: K }>;
}
export const seal = async <K extends OutcomeRecord['kind']>(kind: K, scopeId: string, artifactKey: string, at: string, data: object): Promise<Extract<OutcomeRecord, { kind: K }>> =>
  await sealRecord({ ...data, schemaVersion: 1, kind, scopeId, artifactKey, recordedAt: at }) as Extract<OutcomeRecord, { kind: K }>;
export async function requireNew(tx: OutcomeTransaction, scopeId: string, kind: string, key: Json): Promise<void> {
  const id = await semantic(tx, scopeId, kind, key);
  if (id) reject('OUTC1007', `The ${kind} stage is already complete: ${id}.`);
}
