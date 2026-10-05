import type { InputManifest, ResearchCost, ResearchEvaluatorIdentity, ResearchLifecycle,
  ResearchToolVersions, ResearchWorkflowFrame, ResearchInputArtifact } from './contracts.gen.ts';
import { researchRevisionOf } from './identity.ts';
import { validateResearchShape } from './schema.ts';
import { researchFail, researchValue } from './workflow-contract.ts';

export function researchFrameInputs(frame: ResearchWorkflowFrame): ResearchInputArtifact[] {
  const refs = [...frame.artifacts, ...(frame.checkpoint ? [frame.checkpoint] : [])];
  return [...new Map(refs.map(ref => [ref.admissionId, ref])).values()].sort((a, b) => a.admissionId.localeCompare(b.admissionId));
}
/** Canonical content admission, including root values and control inputs without clocks. */
export async function inputManifestOf(stage: ResearchLifecycle, frame: ResearchWorkflowFrame, promptRevision: string,
  runIdentityId: string, toolVersions: ResearchToolVersions, evaluator: ResearchEvaluatorIdentity, reservation: ResearchCost): Promise<InputManifest> {
  const value = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', frame));
  if (stage !== value.status) researchFail('TRSH1004', '/stage', 'The stage must match its immutable incoming frame.');
  const refs = researchFrameInputs(value);
  const inputs = [...new Map(refs.map(ref => [ref.artifactId, { artifactId: ref.artifactId, sha256: ref.artifactId.slice(4) }])).values()]
    .sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  const tools = [...toolVersions].sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) researchFail('TRSH1002', '/toolVersions', 'Tool names must be unique.');
  const candidate = researchValue(validateResearchShape<InputManifest>('InputManifest', { projectId: value.projectId, stage,
    inputs, promptRevision, runIdentityId, toolVersions: tools, evaluator, reservation,
    ...(value.guidanceHash ? { guidanceHash: value.guidanceHash } : {}) }));
  return researchValue(validateResearchShape<InputManifest>('InputManifest', { ...candidate, controlHash: await researchRevisionOf(value) }));
}
