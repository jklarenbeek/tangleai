/** The scientific gate remains separate from the native, scripted rollback drill. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { runExperientialExample } from '../../examples/experiential.ts';
import type { CgtClaim, CgtEvaluationContext, CgtCandidateEvaluation, CgtRollbackDrill } from './cgt.types.ts';

export async function measureCgtRollback(): Promise<CgtRollbackDrill> {
  const result = await runExperientialExample({ storage: 'memory', pinCount: 32 });
  if (result.scientificApproval || result.physicalRequests !== 0 || !result.restoredHead || !result.previousArtifactId
    || !result.candidateArtifactId || !result.inFlightUnchanged || !result.failedArtifactRetained
    || result.restoredHead.versionId !== result.previousArtifactId || result.restoredHead.revision !== 3 || result.fakeSubmissions !== 2
    || result.pins !== 32 || result.rolloutFraction !== 0.25 || result.tolerance !== 15)
    throw Error('cgt rollback: the native synthetic walkthrough did not retain its exact predecessor.');
  const body: Omit<CgtRollbackDrill, 'receiptId'> = { tier: 'scripted', status: 'passed', datasetId: result.datasetId,
    deploymentId: result.deploymentId, previousArtifactId: result.previousArtifactId, candidateArtifactId: result.candidateArtifactId,
    pins: result.pins!, routed: result.routed!, rolloutFraction: result.rolloutFraction!, tolerance: result.tolerance!,
    restoredHead: result.restoredHead, inFlightUnchanged: result.inFlightUnchanged, failedArtifactRetained: result.failedArtifactRetained,
    fakeSubmissions: result.fakeSubmissions, scientificApproval: false as const, physicalRequests: result.physicalRequests };
  return { ...body, receiptId: await canonicalSha256(body) };
}

export function cgtClaim(context: CgtEvaluationContext, evaluations: CgtCandidateEvaluation[], drill: CgtRollbackDrill): CgtClaim {
  const policy = context.policy;
  const counts = (gate: string) => evaluations.filter(row => !row.evaluation.failures.some(failure => failure.gate === gate)).length;
  return { status: 'not-run', gatePolicyId: policy.id, authorizedLiveRunId: null, rollbackDrillId: drill.receiptId,
    conditions: [
      { id: 'learning', required: `Authorized parametric ${policy.primaryMetric} improves both ${policy.controls.join(' and ')} controls; paired ${policy.interval.level} lower bounds exceed ${policy.learning.minLowerBound}.`,
        observed: `No authorized live evaluation. Scripted ${counts('learning')}/${evaluations.length} pass; the rule follower ties the perfect frozen rule.`, status: 'not-run' },
      { id: 'retention', required: `Every registered retention lane passes its policy tolerance: ${JSON.stringify(policy.retention)}.`,
        observed: `No authorized live evaluation. Scripted ${counts('retention')}/${evaluations.length} pass; both required LoCoMo lanes are not-run.`, status: 'not-run' },
      { id: 'security', required: `All ${policy.security.fixtures.length} registered security fixtures are ${policy.security.requiredOutcome}.`,
        observed: `No authorized live evaluation. Scripted ${counts('security')}/${evaluations.length} pass.`, status: 'not-run' },
      { id: 'operations', required: `The authorized artifact satisfies the registered runtime and resource ceilings: ${JSON.stringify(policy.operations)}.`,
        observed: `No authorized trainer or inference. Scripted ${counts('operations')}/${evaluations.length} pass; fixture accounting is not model performance.`, status: 'not-run' },
      { id: 'rollback', required: 'The authorized live artifact survives an exact prior-artifact rollback with immutable in-flight pins and retained failure evidence.',
        observed: `Scripted native drill ${drill.receiptId}: ${drill.pins} pins, ${drill.routed} canaries, head revision ${drill.restoredHead.revision}; no live deployment.`, status: 'not-run' },
    ] };
}
