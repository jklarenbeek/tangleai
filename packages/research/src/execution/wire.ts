/** Closed bounded archive encoding shared by the remote client and private host. */
import type { ExecutionManifest, ResearchExecutionRequest, ResearchExecutionResponse } from '../contracts.gen.ts';
import { immutableResearchJson, copyResearchBytes } from '../identity.ts';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { captureResearchWorkspace, validateExecutionManifest, researchExecutionOutcome, type ResearchWorkspace } from './manifest.ts';
import type { ResearchExecutionContext, ResearchExecutionResult } from './executor.ts';

export const RESEARCH_RUNNER_WIRE_LIMITS = Object.freeze({ requestBytes: 20971520, responseBytes: 8388608, capabilityBytes: 16384 });
export async function researchExecutionRequest(manifest: ExecutionManifest, supplied: ResearchWorkspace,
  registration: Pick<ResearchExecutionContext, 'contract' | 'plan'>) {
  return researchExecutionOutcome(async () => {
    const pinned = immutableResearchJson({ manifest, contract: registration.contract, plan: registration.plan });
    const workspace = captureResearchWorkspace(supplied);
    researchValue(await validateExecutionManifest(pinned.manifest, workspace, pinned));
    return researchValue(validateResearchShape<ResearchExecutionRequest>('ResearchExecutionRequest', { ...pinned, version: 1,
      workspace: { manifest: workspace.manifest, artifacts: workspace.artifacts.map(row => ({ artifactId: row.artifactId, bytes: [...row.bytes] })) } }));
  });
}
export async function decodeResearchExecutionRequest(input: unknown) {
  return researchExecutionOutcome(async () => {
    const candidate = input as Partial<ResearchExecutionRequest> & { mounts?: unknown; repository?: unknown } | null;
    if (candidate?.manifest?.network?.measured !== 'off' || !/^sha256:[0-9a-f]{64}$/.test(candidate?.manifest?.imageDigest ?? ''))
      researchFail('TRSH1010', '/manifest', 'Remote execution requires network off and a pinned image digest.');
    if ('mounts' in candidate || 'repository' in candidate || candidate.workspace && ('mounts' in candidate.workspace || 'repository' in candidate.workspace))
      researchFail('TRSH1010', '/workspace', 'Remote requests cannot supply host mounts or repositories.');
    const value = researchValue(validateResearchShape<ResearchExecutionRequest>('ResearchExecutionRequest', input));
    const workspace: ResearchWorkspace = { manifest: value.workspace.manifest,
      artifacts: value.workspace.artifacts.map(row => ({ artifactId: row.artifactId, bytes: new Uint8Array(row.bytes) })) };
    const manifest = researchValue(await validateExecutionManifest(value.manifest, workspace, value));
    return { manifest, workspace, contract: value.contract, plan: value.plan };
  });
}
export function researchExecutionResponse(executionManifestHash: string, outcome: import('../errors.ts').ResearchOutcome<ResearchExecutionResult>,
  settlement: ResearchExecutionResponse['settlement'] = outcome.valid ? 'settled' : 'not-started'): ResearchExecutionResponse {
  return researchValue(validateResearchShape<ResearchExecutionResponse>('ResearchExecutionResponse', { version: 1, executionManifestHash, settlement,
    outcome: outcome.valid ? { valid: true, value: { run: outcome.value.run, artifacts: outcome.value.artifacts.map(row => ({ artifactId: row.artifactId,
      bytes: [...copyResearchBytes(row.bytes)] })) } } : outcome }));
}
