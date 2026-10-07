import assert from 'node:assert/strict';
import { resolveProfile, type ProfileRegistry, type HostManifest } from '@tangleai/config';
import { createExperientialDeployment } from '@tangleai/experiential';
import configuration from '../fixtures/config-conformance.json' with { type: 'json' };
import { addressedFixture, accepted } from './identity-fixtures.ts';

/** Configuration and state conformance only; no training or quality claim. */
export async function inferenceFixture() {
  const registry = structuredClone(configuration.base.registry) as ProfileRegistry;
  const host = structuredClone(configuration.base.host) as HostManifest;
  const profile = registry.profiles[0]; assert.equal(profile.kind, 'root');
  if (profile.kind !== 'root') throw Error('Expected the fixture root profile.');
  profile.roles = { chat: { ...profile.roles.answer, capability: null, candidate: 'chat-beta' } };
  const request = { kind: 'profile' as const, profile: 'base', overrides: null };
  const resolved = await resolveProfile({ registry, request, host }); assert.ok(resolved.ok);
  const identity = resolved.identity, role = identity.roles.chat;
  const baseArtifact = await addressedFixture('artifact', { kind: 'base', baseArtifactId: null, method: null, trainingRunId: null,
    runtime: { provider: role.provider, base: role.base, servedModel: role.model } });
  const deployment = accepted(await createExperientialDeployment({ profile: 'base', scope: baseArtifact.scope,
    candidateId: 'chat-beta', baseArtifact, operationalLimits: { maxFailureRate: 0.1, maxP95Ms: 200, window: 20 },
    recordedAt: baseArtifact.recordedAt }));
  return { registry, request, host, identity, baseArtifact, deployment, artifacts: [], capability: { trainable: true },
    recordedAt: baseArtifact.recordedAt, runId: 'inference-conformance-run' };
}
