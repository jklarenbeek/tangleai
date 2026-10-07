/** Resolve configuration once; keep each run's serving choice immutable. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
import { resolveProfile, type Issue, type ResolveInput, type RunIdentity } from '@tangleai/config';
import type { createChatClient } from '@tangleai/models';
import { checkExperientialRecord, sealExperientialRecord } from './identity.ts';
import { experientialBaseDigest } from './deployment.ts';
import { routesToCanary } from './canary.ts';
import { validateExperientialShape } from './schema.ts';
import { experientialIssue, refuseExperiential, experientialNativeCause, type ExperientialResult } from './errors.ts';
import type { ExperientialArtifact, ExperientialDeployment, ExperientialInferenceCapability, ExperientialInferencePin } from './contracts.gen.ts';
import type { ExperientialStore } from './store-types.ts';

export interface ExperientialInferenceInput extends ResolveInput {
  deployment: ExperientialDeployment;
  artifacts: readonly ExperientialArtifact[];
  capability: ExperientialInferenceCapability;
  runId: string;
  recordedAt: string;
}
export interface ExperientialResolvedInference { identity: RunIdentity; pin: ExperientialInferencePin }
export interface ExperientialInferenceBinding {
  capability: ExperientialInferenceCapability;
  clientFor(pin: ExperientialInferencePin, identity: RunIdentity): ReturnType<typeof createChatClient> | Promise<ReturnType<typeof createChatClient>>;
}

function capture(input: ExperientialInferenceInput): ExperientialResult<ExperientialInferenceInput> {
  try {
    const value = JSON.parse(canonicalizeJson(input));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an input object.');
    return { ok: true, value };
  }
  catch { return refuseExperiential('TEXP1001', '', 'Inference resolution requires finite JSON data.'); }
}

async function pinFor(input: ExperientialInferenceInput, identity: RunIdentity): Promise<ExperientialResult<ExperientialResolvedInference>> {
  const deployment = await checkExperientialRecord('deployment', input?.deployment);
  if (!deployment.ok) return deployment;
  const capability = validateExperientialShape<ExperientialInferenceCapability>('ExperientialInferenceCapability', input.capability);
  if (!capability.ok) return capability;
  const d = deployment.value, role = identity.roles.chat;
  if (identity.requested.kind !== 'profile' || identity.requested.profile !== d.profile)
    return refuseExperiential('TEXP1005', '/profile', 'Inference must resolve the deployment\'s named profile.');
  if (!role || await experientialBaseDigest(role) !== d.base.digest)
    return refuseExperiential('TEXP1002', '/deployment/base', 'The deployment base differs from the resolved profile.');
  if (!Array.isArray(input.artifacts) || input.artifacts.length > 4096)
    return refuseExperiential('TEXP1001', '/artifacts', 'Expected a bounded artifact inventory.');
  if (typeof input.runId !== 'string' || !input.runId.trim() || input.runId.length > 256)
    return refuseExperiential('TEXP1001', '/runId', 'Expected a bounded nonempty run id.');
  if (!capability.value.trainable && (d.activeArtifactId !== null || d.canaryArtifactId !== null))
    return refuseExperiential('TEXP1008', '/capability', 'An inference-only binding cannot serve a learned deployment.');
  const canary = await routesToCanary(d, input.runId), artifactId = canary ? d.canaryArtifactId : d.activeArtifactId;
  let servedModel = role.model;
  if (artifactId !== null) {
    const matches = input.artifacts.filter(artifact => artifact?.id === artifactId);
    if (matches.length !== 1) return refuseExperiential('TEXP1004', '/artifacts', 'The serving artifact must resolve exactly once.');
    const artifact = await checkExperientialRecord('artifact', matches[0]);
    if (!artifact.ok) return artifact;
    const a = artifact.value;
    if (a.scope !== d.scope) return refuseExperiential('TEXP1005', '/artifact/scope', 'The serving artifact belongs to another scope.');
    if (a.state !== (canary ? 'canary' : 'active')) return refuseExperiential('TEXP1006', '/artifact/state', 'The artifact is not in its selected serving state.');
    if (a.runtime.provider !== role.provider || a.runtime.base !== role.base)
      return refuseExperiential('TEXP1008', '/artifact/runtime', 'The artifact runtime differs from the deployment endpoint.');
    servedModel = a.runtime.servedModel;
  }
  const pin = await sealExperientialRecord('inferencePin', { document: 'experiential-inference-pin', schemaVersion: 1,
    scope: d.scope, recordedAt: input.recordedAt, runId: input.runId, identityId: identity.identityId,
    deploymentId: d.id, deploymentRevision: d.revision, artifactId, servedModel, canary, capability: capability.value });
  return pin.ok ? { ok: true, value: deepFreeze({ identity, pin: pin.value }) } : pin;
}

/** No store, client, environment or clock is read by resolution. */
export async function resolveExperientialInference(input: ExperientialInferenceInput): Promise<ExperientialResult<ExperientialResolvedInference>> {
  const captured = capture(input); if (!captured.ok) return captured;
  const resolved = await resolveProfile(captured.value);
  if (!resolved.ok) return { ok: false, issues: resolved.issues.map(cause => experientialIssue('TEXP1002', cause.path, 'Profile resolution refused.', cause)) };
  return pinFor(captured.value, resolved.identity);
}

export interface ExperientialInferenceHostInput extends Omit<ExperientialInferenceInput, 'runId' | 'capability'> {
  binding: ExperientialInferenceBinding;
  store: Pick<ExperientialStore, 'pin'>;
  putIdentity(identity: RunIdentity): Promise<{ ok: true; id: string } | { ok: false; issues: Issue[] }>;
  /** The host delegates to RunLog.startRun(kind, { identityId }). */
  startRun(identity: RunIdentity): Promise<{ id: string }>;
}

/** Identity → native run id → transactional pin → client construction. */
export async function startExperientialInference(input: ExperientialInferenceHostInput): Promise<ExperientialResult<ExperientialResolvedInference & { client: ReturnType<typeof createChatClient> }>> {
  if (!input || typeof input.putIdentity !== 'function' || typeof input.startRun !== 'function'
    || typeof input.store?.pin !== 'function' || typeof input.binding?.clientFor !== 'function')
    return refuseExperiential('TEXP1001', '/host', 'Identity, run, pin and client bindings are required.');
  const captured = capture({ registry: input.registry, request: input.request, host: input.host,
    deployment: input.deployment, artifacts: input.artifacts, recordedAt: input.recordedAt,
    capability: input.binding.capability, runId: 'pending-native-run-id' });
  if (!captured.ok) return captured;
  const resolved = await resolveProfile(captured.value);
  if (!resolved.ok) return { ok: false, issues: resolved.issues.map(cause => experientialIssue('TEXP1002', cause.path, 'Profile resolution refused.', cause)) };
  try {
    const identity = await input.putIdentity(resolved.identity);
    if (!identity.ok) return { ok: false, issues: identity.issues.map(cause => experientialIssue('TEXP1002', cause.path, 'Identity persistence refused.', cause)) };
    if (identity.id !== resolved.identity.identityId)
      return refuseExperiential('TEXP1002', '/identityId', 'The retained identity differs from the resolved configuration.');
    const run = await input.startRun(resolved.identity);
    const choice = await pinFor({ ...captured.value, runId: run.id }, resolved.identity);
    if (!choice.ok) return choice;
    const retained = await input.store.pin(choice.value.pin);
    if (!retained.ok) return retained;
    const client = await input.binding.clientFor(retained.value, resolved.identity);
    return { ok: true, value: { identity: resolved.identity, pin: retained.value, client } };
  } catch (error) {
    return refuseExperiential('TEXP1009', '/host', 'The inference host failed before publishing a ready client.', experientialNativeCause(error));
  }
}
