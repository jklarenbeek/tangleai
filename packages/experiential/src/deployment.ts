/** Stable deployment registration and threshold-only rollback advice. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
import { checkExperientialRecord, sealExperientialRecord, experientialBaseDigest } from './identity.ts';
import { validateExperientialShape } from './schema.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialArtifact, ExperientialDeployment, ExperientialOperationalLimits,
  ExperientialOperationalWindow, ExperientialRollbackIntent } from './contracts.gen.ts';

export { experientialBaseDigest } from './identity.ts';

export interface ExperientialDeploymentInput {
  profile: string;
  scope: string;
  candidateId: string;
  baseArtifact: ExperientialArtifact;
  operationalLimits: ExperientialOperationalLimits;
  recordedAt: string;
}

export async function createExperientialDeployment(input: ExperientialDeploymentInput): Promise<ExperientialResult<ExperientialDeployment>> {
  let captured: ExperientialDeploymentInput;
  try { captured = JSON.parse(canonicalizeJson(input)); }
  catch { return refuseExperiential('TEXP1001', '', 'Deployment registration requires finite JSON data.'); }
  const base = await checkExperientialRecord('artifact', captured?.baseArtifact);
  if (!base.ok) return base;
  if (base.value.kind !== 'base' || base.value.baseArtifactId !== null || base.value.trainingRunId !== null)
    return refuseExperiential('TEXP1004', '/baseArtifact', 'A deployment must start from a registered base artifact.');
  if (base.value.scope !== captured.scope) return refuseExperiential('TEXP1005', '/scope', 'The base artifact belongs to another scope.');
  const role = { provider: base.value.runtime.provider, base: base.value.runtime.base, model: base.value.runtime.servedModel };
  return sealExperientialRecord('deployment', { document: 'experiential-deployment', schemaVersion: 1,
    scope: captured.scope, profile: captured.profile, recordedAt: captured.recordedAt,
    base: { candidateId: captured.candidateId, ...role, digest: await experientialBaseDigest(role) },
    baseArtifactId: base.value.id, activeArtifactId: null, canaryArtifactId: null, rolloutFraction: 0,
    expectedParentArtifactId: null, approvalId: null, revision: 0, headRevision: 0, rollbackReason: null,
    operationalLimits: captured.operationalLimits });
}

/** Advice carries no approval authority. A host must retain a policy approval. */
export async function planAutomaticRollback(deployment: ExperientialDeployment, observedWindow: ExperientialOperationalWindow): Promise<ExperientialResult<ExperientialRollbackIntent | null>> {
  const pending = checkExperientialRecord('deployment', deployment);
  const observed = validateExperientialShape<ExperientialOperationalWindow>('ExperientialOperationalWindow', observedWindow);
  const registered = await pending;
  if (!registered.ok) return registered;
  if (!observed.ok) return observed;
  const d = registered.value, w = observed.value, limit = d.operationalLimits;
  if (w.deploymentId !== d.id || w.deploymentRevision !== d.revision)
    return refuseExperiential('TEXP1002', '/observedWindow', 'The window must name this exact deployment revision.');
  if (w.count < limit.window) return { ok: true, value: null };
  if (w.count !== limit.window) return refuseExperiential('TEXP1001', '/observedWindow/count', 'The window exceeds its registered sample count.');
  const reasons = [];
  if (w.failureRate > limit.maxFailureRate) reasons.push(`failure rate ${w.failureRate} exceeds ${limit.maxFailureRate}`);
  if (w.p95Ms > limit.maxP95Ms) reasons.push(`p95 ${w.p95Ms} ms exceeds ${limit.maxP95Ms} ms`);
  if (!reasons.length) return { ok: true, value: null };
  if (!d.expectedParentArtifactId)
    return refuseExperiential('TEXP1006', '/expectedParentArtifactId', 'This deployment has no prior approved artifact to restore.');
  return { ok: true, value: deepFreeze({ deploymentId: d.id, deploymentRevision: d.revision,
    expectedHead: { versionId: d.activeArtifactId, revision: d.headRevision }, targetArtifactId: d.expectedParentArtifactId,
    reason: 'Registered operational rollback: ' + reasons.join('; '), observed: w }) };
}
