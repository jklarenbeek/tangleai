import { createMemoryResearchStore, planProjectCreate, planStateTransition, planStageCommit,
  inputManifestHashOf, stageAttemptIdOf, researchArtifactIdOf, validateResearchShape } from '@tangleai/research';
import schema from '@tangleai/research/schemas/research' with { type: 'json' };

const value = result => {
  if (result.valid === true || result.ok === true) return result.value;
  throw new Error(JSON.stringify(result));
};
export async function exerciseResearchConsumer(store) {
  const project = { id: 'packed-research', topic: 'fixture', domainProfile: 'computational', question: 'Does storage replay?',
    owner: 'fixture', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED', createdAt: '2026-10-03T00:00:00.000Z',
    budget: { calls: 1, tokens: 10, ms: 100, physical: 1 } };
  let state = value(await store.createProject(value(planProjectCreate(project))));
  state = value(await store.transition(value(planStateTransition(state, 'DISCOVERY'))));
  const manifest = { projectId: project.id, stage: 'DISCOVERY', inputs: [], promptRevision: 'a'.repeat(64), runIdentityId: 'b'.repeat(64),
    toolVersions: [{ name: 'fixture', version: '1' }], evaluator: { id: 'fixture', version: '1' }, reservation: project.budget };
  const key = { projectId: project.id, stage: 'DISCOVERY', attemptOrdinal: 1, inputManifestHash: await inputManifestHashOf(manifest) };
  const bytes = new TextEncoder().encode('abc');
  const admission = value(await store.stageArtifact(bytes, { projectId: project.id, attempt: key, mediaType: 'text/plain',
    verification: 'verified', parents: [{ artifactId: project.id, admissionId: null }] }));
  const attempt = { ...key, id: await stageAttemptIdOf(key), masPath: 'packed/discovery/1', promptRevision: manifest.promptRevision,
    runIdentityId: manifest.runIdentityId, toolVersions: manifest.toolVersions, spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
    stopReason: 'completed', interventions: [], outputArtifactIds: [admission.artifact.id], error: null, mode: 'scripted' };
  const plan = value(await planStageCommit({ state, attempt, manifest, nextStatus: 'LITERATURE_GATE', artifactAdmissionIds: [admission.id] }));
  const receipt = value(await store.commitStage(plan)), replay = await store.commitStage(plan); value(replay);
  const read = value(await store.readArtifact(project.id, admission.id)); read.bytes[0] = 0;
  const reread = value(await store.readArtifact(project.id, admission.id));
  const invalid = validateResearchShape('ResearchProject', { ...project, status: 'unknown' });
  if (!schema.$defs.ResearchProject || invalid.valid || invalid.issues[0].path !== '/status') throw new Error('Packed schema ownership differs');
  return { plan, summary: { state: receipt.nextState.status, attempts: value(await store.snapshot(project.id)).attempts.length,
    replayed: replay.replayed === true, bytes: [...reread.bytes], artifactId: await researchArtifactIdOf(bytes), refusal: invalid.issues[0].code } };
}
export async function qualifyResearchBrowser() { return (await exerciseResearchConsumer(createMemoryResearchStore())).summary; }
