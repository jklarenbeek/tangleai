/** Human requests are immutable control inputs, never observations or verified claims. */
import type { HumanCommand, ResearchDirective, ResearchInputArtifact, StageAttemptKey } from './contracts.gen.ts';
import type { ResearchStore } from './store.ts';
import type { ResearchStageAccess, ResearchStageOperation } from './handlers.ts';
import { createStagedArtifactRefiner } from './refiner.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import { validateResearchShape } from './schema.ts';
import { researchRevisionOf } from './identity.ts';

export const RESEARCH_DIRECTIVE_MEDIA = 'application/vnd.tangleai.research-directive+json';
export async function researchGateEditor(store: ResearchStore, projectId: string, command: Extract<HumanCommand, { kind: 'edit' }>, attempt: StageAttemptKey) {
  const source: ResearchInputArtifact = { artifactId: command.artifactId, admissionId: command.admissionId };
  const row = researchValue(await store.readArtifact(projectId, source.admissionId));
  const design = command.target === 'design' && row.admission.artifact.mediaType === 'application/json';
  const write = command.target === 'write' && row.admission.artifact.mediaType === 'application/vnd.tangleai.research-writing-proposal+json';
  if (!design && !write) researchFail('TRSH1005', '/artifactId', 'Edits address a reviewed design or writer proposal; measured evidence is immutable.');
  return createStagedArtifactRefiner({ store, projectId, source, attempt,
    schema: design ? 'ResearchEditableDesign' : 'ResearchEditableDraft', allowedPaths: ['/proposal'] });
}

/** Exact next-stage scope prevents an old request from silently controlling a later retry. */
export async function readResearchDirective(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<ResearchDirective | null> {
  const found: ResearchDirective[] = [];
  for (const ref of operation.frame.artifacts) {
    if ((await access.describeArtifact(ref)).mediaType !== RESEARCH_DIRECTIVE_MEDIA) continue;
    const row = researchValue(validateResearchShape<ResearchDirective>('ResearchDirective',
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await access.readArtifact(ref)))));
    if (row.stage !== operation.frame.status || row.stateRevision !== operation.expectedState.revision) continue;
    if (row.guidanceHash !== null && (row.guidanceHash !== await researchRevisionOf({ text: row.text })
      || row.guidanceHash !== operation.manifest.guidanceHash))
      researchFail('TRSH1002', '/guidanceHash', 'The next attempt must admit the exact human guidance hash.');
    found.push(row);
  }
  if (found.length > 1) researchFail('TRSH1004', '/directive', 'A stage cannot consume conflicting human requests.');
  return found[0] ?? null;
}
