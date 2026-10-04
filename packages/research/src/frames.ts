/** Full evidence lives in committed artifacts; native execution can carry its immutable reference. */
import { equalsJson } from '@jarenjs/core/object';
import type { ResearchStore } from './store.ts';
import type { ResearchWorkflowFrame, StageCommitReceipt } from './contracts.gen.ts';
import { immutableResearchJson } from './identity.ts';
import { validateResearchShape } from './schema.ts';
import { researchFail, researchValue } from './workflow-contract.ts';

export const RESEARCH_FRAME_MEDIA_TYPE = 'application/vnd.tangleai.research-frame+json';
export function researchWireFrame(frame: ResearchWorkflowFrame, compact: boolean): ResearchWorkflowFrame {
  return immutableResearchJson(compact && frame.checkpoint && !frame.gate ? { ...frame, artifacts: [] } : frame);
}
export async function resolveResearchFrame(store: ResearchStore, input: ResearchWorkflowFrame): Promise<ResearchWorkflowFrame> {
  const frame = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', input));
  if (frame.artifacts.length || !frame.checkpoint || frame.gate) return frame;
  const row = researchValue(await store.readArtifact(frame.projectId, frame.checkpoint.admissionId));
  const snapshot = researchValue(await store.snapshot(frame.projectId));
  if (!snapshot?.committedAdmissionIds.includes(row.admission.id) || row.admission.artifact.id !== frame.checkpoint.artifactId
    || row.admission.artifact.mediaType !== RESEARCH_FRAME_MEDIA_TYPE)
    researchFail('TRSH1005', '/checkpoint', 'Compact control must resolve to a committed research frame.');
  const body = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', JSON.parse(new TextDecoder().decode(row.bytes))));
  const expanded = { ...body, checkpoint: frame.checkpoint };
  if (body.checkpoint !== null || !equalsJson({ ...expanded, artifacts: [] }, frame))
    researchFail('TRSH1002', '/checkpoint', 'Compact frame control differs from its committed evidence.');
  return immutableResearchJson(expanded);
}
export async function restoredResearchFrame(store: ResearchStore, receipt: StageCommitReceipt): Promise<ResearchWorkflowFrame> {
  const frames = [];
  for (const id of receipt.artifactAdmissionIds) {
    const row = researchValue(await store.readArtifact(receipt.attempt.projectId, id));
    if (row.admission.artifact.mediaType === RESEARCH_FRAME_MEDIA_TYPE) frames.push(row);
  }
  if (frames.length !== 1) researchFail('TRSH1002', '/attempt/outputArtifactIds', 'Committed stage must contain exactly one recovery frame.');
  const row = frames[0], body = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', JSON.parse(new TextDecoder().decode(row.bytes))));
  if (body.checkpoint !== null || body.status !== receipt.nextState.status || body.projectId !== receipt.attempt.projectId)
    researchFail('TRSH1002', '/checkpoint', 'Recovery frame differs from its committed transition.');
  return immutableResearchJson({ ...body, checkpoint: { artifactId: row.admission.artifact.id, admissionId: row.admission.id } });
}
